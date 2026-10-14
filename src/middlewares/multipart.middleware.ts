import { Request, Response, NextFunction } from 'express';
import { Readable } from 'stream';
import logger from '../logger.js';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Middleware that parses multipart/form-data natively using Node.js built-in Web API stream.
 * Converts uploaded file (e.g. `odometer_photo`) into a Base64 Data URI string,
 * parses nested JSON string fields like `device_details`, and populates `req.body`.
 * 
 * If the request is already application/json, this middleware is a no-op and calls next().
 */
export const parseOdometerFormData = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return next();
  }

  try {
    const webStream = Readable.toWeb(req) as any;
    const headers = new globalThis.Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        headers.set(key, Array.isArray(value) ? value.join(',') : String(value));
      }
    }

    const host = req.get('host') || 'localhost';
    const webReq = new globalThis.Request(`http://${host}${req.originalUrl || req.url}`, {
      method: req.method,
      headers,
      body: webStream,
      duplex: 'half',
    } as any);

    const formData = await webReq.formData();
    const parsedBody: Record<string, any> = {};

    for (const [key, value] of formData.entries()) {
      if (typeof value === 'object' && typeof (value as any).arrayBuffer === 'function') {
        const file = value as File;
        
        // Enforce 5 MB limit on uploaded image
        if (file.size > MAX_PHOTO_BYTES) {
          res.status(413).json({
            error: 'Payload Too Large: odometer_photo exceeds the maximum allowed size of 5 MB',
          });
          return;
        }

        let mimeType = file.type || '';
        if (!mimeType || mimeType === 'application/octet-stream') {
          // Infer from filename if missing or generic
          const lowerName = (file.name || '').toLowerCase();
          if (lowerName.endsWith('.png')) {
            mimeType = 'image/png';
          } else {
            mimeType = 'image/jpeg';
          }
        }

        const arrayBuf = await file.arrayBuffer();
        const base64Data = Buffer.from(arrayBuf).toString('base64');
        parsedBody[key] = `data:${mimeType};base64,${base64Data}`;
      } else if (typeof value === 'string') {
        // If device_details was passed as JSON string in form-data
        if (key === 'device_details') {
          try {
            parsedBody[key] = JSON.parse(value);
          } catch {
            parsedBody[key] = value;
          }
        } else {
          parsedBody[key] = value;
        }
      }
    }

    req.body = parsedBody;
    next();
  } catch (error: any) {
    logger.error('Failed to parse multipart/form-data', {
      error: error?.message ?? String(error),
      stack: error?.stack,
    });
    res.status(400).json({ error: 'Invalid multipart/form-data payload' });
  }
};
