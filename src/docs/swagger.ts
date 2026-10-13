import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import yaml from 'yamljs';
import path from 'path';

export const createSwaggerRouter = (): Router => {
  const router = Router();
  const swaggerDocumentPath = path.resolve(process.cwd(), 'src/docs/openapi.yaml');
  const swaggerDocument = yaml.load(swaggerDocumentPath);

  // Serve raw JSON specification
  router.get('/docs/json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerDocument);
  });

  // Serve Swagger UI documentation
  router.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

  return router;
};
