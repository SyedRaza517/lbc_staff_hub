// Express 4 does not catch errors thrown from an ASYNC route handler: the returned
// promise rejects, nothing calls next(err), the error middleware never runs, and
// Node treats it as an unhandled rejection — which terminates the whole process.
//
// That turned a single bad database row into a total outage: GET /api/adjustments
// threw inside Prisma, the API died, and because the client loads adjustments on
// every sign-in it died again the moment anyone reconnected.
//
// wrapAsync patches a router's handlers so a rejected promise is forwarded to
// next(), reaching the error middleware in index.js and producing a 500 instead of
// killing the server. Applied centrally so no individual route has to remember.
function wrapAsync(router) {
  for (const layer of router.stack || []) {
    if (!layer.route) continue;
    for (const entry of layer.route.stack) {
      const handler = entry.handle;
      // Arity 4 means (err, req, res, next) — an error handler, leave it alone.
      if (typeof handler !== "function" || handler.length >= 4) continue;
      entry.handle = function wrapped(req, res, next) {
        try {
          const result = handler.call(this, req, res, next);
          if (result && typeof result.catch === "function") result.catch(next);
          return result;
        } catch (err) {
          next(err);
        }
      };
    }
  }
  return router;
}

module.exports = { wrapAsync };
