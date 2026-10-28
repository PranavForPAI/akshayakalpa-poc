import {
  createMat4,
  identityMat4,
  createVec4,
  multiplyMat4,
  transposeMat4,
  addMat4,
  subMat4,
  multiplyMatVec4,
  invertMat4,
  invertMat2,
  type Mat4,
  type Vec4,
} from '../math/matrix4.js';
import { getUtmZone, getTransformer } from '../geo/projection.js';
import type {
  TripContext,
  RawPoint,
  MovingChunk,
  ProjectedPoint,
  SmoothedPoint,
  PointFlag,
} from '../types.js';

interface KalmanStepRecord {
  point: ProjectedPoint;
  isRejected: boolean;
  xPred: Vec4;
  pPred: Mat4;
  xFilt: Vec4;
  pFilt: Mat4;
  F: Mat4;
}

/**
 * Builds state transition matrix F for time step dt:
 * [1, 0, dt, 0; 0, 1, 0, dt; 0, 0, 1, 0; 0, 0, 0, 1]
 */
function buildF(dt: number): Mat4 {
  const F = identityMat4();
  F[2] = dt;
  F[7] = dt;
  return F;
}

/**
 * Discrete white-noise-acceleration process noise covariance Q:
 * Q = sigma_a^2 * [dt^3/3, 0, dt^2/2, 0; 0, dt^3/3, 0, dt^2/2; dt^2/2, 0, dt, 0; 0, dt^2/2, 0, dt]
 */
function buildQ(dt: number, sigmaA: number): Mat4 {
  const q = sigmaA * sigmaA;
  const dt2 = dt * dt;
  const dt3 = dt2 * dt;
  const Q = createMat4();

  const c11 = (dt3 / 3) * q;
  const c13 = (dt2 / 2) * q;
  const c33 = dt * q;

  Q[0] = c11;
  Q[2] = c13;
  Q[5] = c11;
  Q[7] = c13;
  Q[8] = c13;
  Q[10] = c33;
  Q[13] = c13;
  Q[15] = c33;

  return Q;
}

/**
 * Stage 3: Split into Moving Chunks and apply Kalman filter with RTS Backward Smoother.
 */
export function kalmanRtsStage(ctx: TripContext): TripContext {
  const points = ctx.filteredPoints ?? [];
  const absorbed = ctx.absorbedPointIds ?? new Set<number>();
  const { config } = ctx;

  // 1. Gather moving points (not absorbed into stops)
  const movingPoints = points.filter((p) => p.id === undefined || !absorbed.has(p.id));

  if (movingPoints.length === 0) {
    ctx.chunks = [];
    ctx.smoothedPoints = [];
    return ctx;
  }

  // 2. Split into chunks wherever time gap > gapSplitS
  const rawChunks: RawPoint[][] = [];
  let currentChunk: RawPoint[] = [movingPoints[0]];

  for (let i = 1; i < movingPoints.length; i++) {
    const prev = movingPoints[i - 1];
    const curr = movingPoints[i];
    const dtSec = (curr.deviceTime.getTime() - prev.deviceTime.getTime()) / 1000;

    if (dtSec > config.gapSplitS) {
      rawChunks.push(currentChunk);
      currentChunk = [curr];
    } else {
      currentChunk.push(curr);
    }
  }
  if (currentChunk.length > 0) {
    rawChunks.push(currentChunk);
  }

  // 3. Project each chunk to UTM metric coordinates using chunk centroid
  const chunks: MovingChunk[] = rawChunks.map((chunkPoints, chunkIdx) => {
    const meanLon =
      chunkPoints.reduce((acc, p) => acc + p.longitude, 0) / chunkPoints.length;
    const utmZone = getUtmZone(meanLon);
    const transformer = getTransformer(utmZone);

    const projected: ProjectedPoint[] = chunkPoints.map((p, idx) => {
      const [x, y] = transformer.forward(p.longitude, p.latitude);
      const tsSec = p.deviceTime.getTime() / 1000;
      const prevTsSec = idx > 0 ? chunkPoints[idx - 1].deviceTime.getTime() / 1000 : tsSec;
      const dtSec = Math.max(0.1, tsSec - prevTsSec);
      return {
        ...p,
        x,
        y,
        utmZone,
        tsSec,
        dtSec: idx === 0 ? 0 : dtSec,
      };
    });

    return {
      chunkIndex: chunkIdx,
      utmZone,
      epsg: transformer.epsg,
      points: projected,
    };
  });

  ctx.chunks = chunks;

  // 4. Run Kalman Forward Pass + RTS Backward Smoothing on each chunk
  const allSmoothedPoints: SmoothedPoint[] = [];

  for (const chunk of chunks) {
    const chunkPts = chunk.points;
    const nPts = chunkPts.length;
    if (nPts === 0) continue;

    const transformer = getTransformer(chunk.utmZone);

    // Single-point chunk edge case
    if (nPts === 1) {
      const p = chunkPts[0];
      allSmoothedPoints.push({
        rawPointId: p.id,
        latitude: p.latitude,
        longitude: p.longitude,
        deviceTime: p.deviceTime,
        x: p.x,
        y: p.y,
        vx: 0,
        vy: 0,
        sigmaM: p.accuracyMeters ?? config.minSigmaM,
        speedMps: p.speedMps ?? 0,
        source: 'smoothed',
        flags: ['gap_edge'],
        chunkIndex: chunk.chunkIndex,
      });
      continue;
    }

    const records: KalmanStepRecord[] = [];
    let consecutiveRejects = 0;

    // Initialize state
    let xCurr = createVec4(chunkPts[0].x, chunkPts[0].y, 0, 0);
    if (nPts > 1 && chunkPts[1].dtSec > 0) {
      const initVx = (chunkPts[1].x - chunkPts[0].x) / chunkPts[1].dtSec;
      const initVy = (chunkPts[1].y - chunkPts[0].y) / chunkPts[1].dtSec;
      xCurr[2] = initVx;
      xCurr[3] = initVy;
    }

    const initPosSigma = Math.max(chunkPts[0].accuracyMeters ?? 10.0, config.minSigmaM);
    let pCurr = identityMat4();
    pCurr[0] = initPosSigma * initPosSigma;
    pCurr[5] = initPosSigma * initPosSigma;
    pCurr[10] = 100.0; // High initial velocity uncertainty (10 m/s sigma)
    pCurr[15] = 100.0;

    // Forward pass
    for (let k = 0; k < nPts; k++) {
      const pt = chunkPts[k];

      if (k === 0) {
        records.push({
          point: pt,
          isRejected: false,
          xPred: new Float64Array(xCurr),
          pPred: new Float64Array(pCurr),
          xFilt: new Float64Array(xCurr),
          pFilt: new Float64Array(pCurr),
          F: identityMat4(),
        });
        continue;
      }

      const dt = Math.max(0.01, pt.dtSec);
      const F = buildF(dt);
      const Q = buildQ(dt, config.kfQ);

      // 1. Predict
      const xPred = multiplyMatVec4(F, xCurr);
      const FP = multiplyMat4(F, pCurr);
      const FT = transposeMat4(F);
      const pPred = addMat4(multiplyMat4(FP, FT), Q);

      // 2. Measure & Innovation Gate
      const posSigma = Math.max(pt.accuracyMeters ?? 10.0, config.minSigmaM);
      const posVar = posSigma * posSigma;

      // Innovation: residual y = z - H * xPred
      const yPos = [pt.x - xPred[0], pt.y - xPred[1]];
      // S = H P_pred H^T + R for position (2x2)
      const S2: [number, number, number, number] = [
        pPred[0] + posVar,
        pPred[1],
        pPred[4],
        pPred[5] + posVar,
      ];
      const invS2 = invertMat2(S2);

      let isRejected = false;
      let mahalanobisSq = 0;

      if (invS2) {
        mahalanobisSq =
          yPos[0] * (invS2[0] * yPos[0] + invS2[1] * yPos[1]) +
          yPos[1] * (invS2[2] * yPos[0] + invS2[3] * yPos[1]);
        if (mahalanobisSq > config.chi2Gate) {
          isRejected = true;
        }
      }

      if (isRejected) {
        consecutiveRejects++;
        if (consecutiveRejects >= config.maxConsecutiveRejects) {
          // Re-initialize filter at current measurement
          xCurr = createVec4(pt.x, pt.y, 0, 0);
          pCurr = identityMat4();
          pCurr[0] = posVar;
          pCurr[5] = posVar;
          pCurr[10] = 100.0;
          pCurr[15] = 100.0;
          consecutiveRejects = 0;
        } else {
          // Keep predicted state when rejected
          xCurr = xPred;
          pCurr = pPred;
        }

        records.push({
          point: pt,
          isRejected: true,
          xPred,
          pPred,
          xFilt: new Float64Array(xCurr),
          pFilt: new Float64Array(pCurr),
          F,
        });
        continue;
      }

      // Innovation accepted! Reset reject counter
      consecutiveRejects = 0;

      // Check if Doppler speed and heading are valid for 4D measurement
      const hasDoppler =
        pt.speedMps !== null &&
        pt.speedMps !== undefined &&
        pt.speedMps >= 0 &&
        pt.headingDegrees !== null &&
        pt.headingDegrees !== undefined &&
        (pt.speedAccuracyMps ?? 1.0) < 5.0;

      if (hasDoppler) {
        // 4D measurement: position + velocity
        const headingRad = (pt.headingDegrees! * Math.PI) / 180;
        const vxMeas = pt.speedMps! * Math.sin(headingRad);
        const vyMeas = pt.speedMps! * Math.cos(headingRad);
        const speedAcc = Math.max(0.2, pt.speedAccuracyMps ?? 1.0);
        const speedVar = speedAcc * speedAcc;

        const y = createVec4(
          pt.x - xPred[0],
          pt.y - xPred[1],
          vxMeas - xPred[2],
          vyMeas - xPred[3]
        );

        const S = new Float64Array(pPred);
        S[0] += posVar;
        S[5] += posVar;
        S[10] += speedVar;
        S[15] += speedVar;

        const invS = invertMat4(S);
        if (invS) {
          // Kalman Gain K = P_pred * S^-1
          const K = multiplyMat4(pPred, invS);
          const Ky = multiplyMatVec4(K, y);
          xCurr = createVec4(
            xPred[0] + Ky[0],
            xPred[1] + Ky[1],
            xPred[2] + Ky[2],
            xPred[3] + Ky[3]
          );
          // Joseph form / standard update P = (I - K) * P_pred
          const I_K = subMat4(identityMat4(), K);
          pCurr = multiplyMat4(I_K, pPred);
        } else {
          xCurr = xPred;
          pCurr = pPred;
        }
      } else {
        // 2D position update using invS2
        if (invS2) {
          // K = P_pred * H^T * invS2 (size 4x2)
          const K: [number, number, number, number, number, number, number, number] = [
            pPred[0] * invS2[0] + pPred[1] * invS2[2],
            pPred[0] * invS2[1] + pPred[1] * invS2[3],
            pPred[4] * invS2[0] + pPred[5] * invS2[2],
            pPred[4] * invS2[1] + pPred[5] * invS2[3],
            pPred[8] * invS2[0] + pPred[9] * invS2[2],
            pPred[8] * invS2[1] + pPred[9] * invS2[3],
            pPred[12] * invS2[0] + pPred[13] * invS2[2],
            pPred[12] * invS2[1] + pPred[13] * invS2[3],
          ];

          xCurr = createVec4(
            xPred[0] + K[0] * yPos[0] + K[1] * yPos[1],
            xPred[1] + K[2] * yPos[0] + K[3] * yPos[1],
            xPred[2] + K[4] * yPos[0] + K[5] * yPos[1],
            xPred[3] + K[6] * yPos[0] + K[7] * yPos[1]
          );

          // P = (I - K*H) * P_pred
          const KH = createMat4();
          KH[0] = K[0];
          KH[1] = K[1];
          KH[4] = K[2];
          KH[5] = K[3];
          KH[8] = K[4];
          KH[9] = K[5];
          KH[12] = K[6];
          KH[13] = K[7];

          pCurr = multiplyMat4(subMat4(identityMat4(), KH), pPred);
        } else {
          xCurr = xPred;
          pCurr = pPred;
        }
      }

      records.push({
        point: pt,
        isRejected: false,
        xPred,
        pPred,
        xFilt: new Float64Array(xCurr),
        pFilt: new Float64Array(pCurr),
        F,
      });
    }

    // 5. Rauch-Tung-Striebel (RTS) Backward Smoother Pass
    const smoothedStates: Vec4[] = new Array(nPts);
    const smoothedCovs: Mat4[] = new Array(nPts);

    // Initialise at last step N-1
    smoothedStates[nPts - 1] = new Float64Array(records[nPts - 1].xFilt);
    smoothedCovs[nPts - 1] = new Float64Array(records[nPts - 1].pFilt);

    for (let k = nPts - 2; k >= 0; k--) {
      const recK = records[k];
      const recNext = records[k + 1];

      // C_k = P_filt,k * F_k+1^T * (P_pred,k+1)^-1
      const FT = transposeMat4(recNext.F);
      const P_FT = multiplyMat4(recK.pFilt, FT);
      const invPPredNext = invertMat4(recNext.pPred);

      if (invPPredNext) {
        const C_k = multiplyMat4(P_FT, invPPredNext);

        // x_smooth = x_filt + C_k * (x_smooth_next - x_pred_next)
        const dx = createVec4(
          smoothedStates[k + 1][0] - recNext.xPred[0],
          smoothedStates[k + 1][1] - recNext.xPred[1],
          smoothedStates[k + 1][2] - recNext.xPred[2],
          smoothedStates[k + 1][3] - recNext.xPred[3]
        );
        const C_dx = multiplyMatVec4(C_k, dx);
        smoothedStates[k] = createVec4(
          recK.xFilt[0] + C_dx[0],
          recK.xFilt[1] + C_dx[1],
          recK.xFilt[2] + C_dx[2],
          recK.xFilt[3] + C_dx[3]
        );

        // P_smooth = P_filt + C_k * (P_smooth_next - P_pred_next) * C_k^T
        const dP = subMat4(smoothedCovs[k + 1], recNext.pPred);
        const CdP = multiplyMat4(C_k, dP);
        const CT = transposeMat4(C_k);
        smoothedCovs[k] = addMat4(recK.pFilt, multiplyMat4(CdP, CT));
      } else {
        smoothedStates[k] = new Float64Array(recK.xFilt);
        smoothedCovs[k] = new Float64Array(recK.pFilt);
      }
    }

    // 6. Project smoothed metric coordinates back to WGS84 and emit SmoothedPoints
    for (let k = 0; k < nPts; k++) {
      const rec = records[k];
      const state = smoothedStates[k];
      const cov = smoothedCovs[k];

      const [lon, lat] = transformer.inverse(state[0], state[1]);
      const speed = Math.sqrt(state[2] * state[2] + state[3] * state[3]);
      // Positional standard deviation sigma_m = sqrt(P_xx + P_yy)
      const sigmaM = Math.sqrt(Math.max(0.1, cov[0] + cov[5]));

      const flags: PointFlag[] = [];
      if (rec.isRejected) {
        flags.push('rejected');
      }
      if (k === 0 || k === nPts - 1) {
        flags.push('gap_edge');
      }

      allSmoothedPoints.push({
        rawPointId: rec.point.id,
        latitude: lat,
        longitude: lon,
        deviceTime: rec.point.deviceTime,
        x: state[0],
        y: state[1],
        vx: state[2],
        vy: state[3],
        sigmaM,
        speedMps: speed,
        source: 'smoothed',
        flags,
        chunkIndex: chunk.chunkIndex,
      });
    }
  }

  ctx.smoothedPoints = allSmoothedPoints;
  return ctx;
}
