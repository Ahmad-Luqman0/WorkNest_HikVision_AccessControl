// Vercel serverless entry — wraps the Express app. All routes (API + static
// dashboard) are handled by this single function; see ../vercel.json.
import app from '../src/server.js';

export default app;
