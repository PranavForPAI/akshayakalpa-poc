/**
 * Matrix4: 4x4 matrix utilities using Float64Array for performance and stability.
 * Indices are row-major: index = row * 4 + col.
 */

export type Mat4 = Float64Array;
export type Vec4 = Float64Array;

export function createMat4(): Mat4 {
  return new Float64Array(16);
}

export function identityMat4(): Mat4 {
  const m = new Float64Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

export function createVec4(x = 0, y = 0, z = 0, w = 0): Vec4 {
  const v = new Float64Array(4);
  v[0] = x;
  v[1] = y;
  v[2] = z;
  v[3] = w;
  return v;
}

export function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[r * 4 + k] * b[k * 4 + c];
      }
      out[r * 4 + c] = sum;
    }
  }
  return out;
}

export function transposeMat4(m: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[c * 4 + r] = m[r * 4 + c];
    }
  }
  return out;
}

export function addMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = a[i] + b[i];
  }
  return out;
}

export function subMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = a[i] - b[i];
  }
  return out;
}

export function multiplyMatVec4(m: Mat4, v: Vec4): Vec4 {
  const out = new Float64Array(4);
  for (let r = 0; r < 4; r++) {
    out[r] =
      m[r * 4 + 0] * v[0] +
      m[r * 4 + 1] * v[1] +
      m[r * 4 + 2] * v[2] +
      m[r * 4 + 3] * v[3];
  }
  return out;
}

/**
 * Inverts a 4x4 matrix using standard Gaussian elimination with partial pivoting.
 */
export function invertMat4(m: Mat4): Mat4 | null {
  const a = new Float64Array(32); // 4 rows x 8 columns [A | I]
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      a[i * 8 + j] = m[i * 4 + j];
    }
    a[i * 8 + 4 + i] = 1.0;
  }

  for (let i = 0; i < 4; i++) {
    // Find pivot
    let maxRow = i;
    let maxVal = Math.abs(a[i * 8 + i]);
    for (let k = i + 1; k < 4; k++) {
      const val = Math.abs(a[k * 8 + i]);
      if (val > maxVal) {
        maxVal = val;
        maxRow = k;
      }
    }

    if (maxVal < 1e-12) {
      return null; // Singular matrix
    }

    // Swap rows if needed
    if (maxRow !== i) {
      for (let k = 0; k < 8; k++) {
        const tmp = a[i * 8 + k];
        a[i * 8 + k] = a[maxRow * 8 + k];
        a[maxRow * 8 + k] = tmp;
      }
    }

    // Scale pivot row
    const pivot = a[i * 8 + i];
    for (let k = 0; k < 8; k++) {
      a[i * 8 + k] /= pivot;
    }

    // Eliminate other rows
    for (let r = 0; r < 4; r++) {
      if (r !== i) {
        const factor = a[r * 8 + i];
        for (let k = 0; k < 8; k++) {
          a[r * 8 + k] -= factor * a[i * 8 + k];
        }
      }
    }
  }

  const inv = new Float64Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      inv[i * 4 + j] = a[i * 8 + 4 + j];
    }
  }
  return inv;
}

/**
 * Inverts a 2x2 matrix: [a, b; c, d]
 */
export function invertMat2(m: [number, number, number, number]): [number, number, number, number] | null {
  const [a, b, c, d] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1.0 / det;
  return [d * invDet, -b * invDet, -c * invDet, a * invDet];
}
