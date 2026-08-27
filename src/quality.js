function metricNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function evaluateQuality(analysis, thresholds = {}) {
  const routes = Array.isArray(analysis.routes) ? analysis.routes : [];
  const complete = route => Boolean(route.summary && route.description && Array.isArray(route.responses) && route.responses.length);
  const documentedRoutes = routes.filter(complete);
  const coverage = routes.length ? documentedRoutes.length / routes.length : 1;
  const confidences = routes.map(route => metricNumber(Number(route.confidence), 0));
  const minimumConfidence = confidences.length ? Math.min(...confidences) : 1;
  const averageConfidence = confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 1;
  const limits = {
    minRouteCoverage: metricNumber(thresholds.minRouteCoverage, 0.8),
    minRouteConfidence: metricNumber(thresholds.minRouteConfidence, 0.7),
    minAverageConfidence: metricNumber(thresholds.minAverageConfidence, 0.75),
  };
  const failures = [];
  if (coverage < limits.minRouteCoverage) failures.push({ metric: 'route coverage', actual: coverage, required: limits.minRouteCoverage });
  if (minimumConfidence < limits.minRouteConfidence) failures.push({ metric: 'minimum route confidence', actual: minimumConfidence, required: limits.minRouteConfidence });
  if (averageConfidence < limits.minAverageConfidence) failures.push({ metric: 'average route confidence', actual: averageConfidence, required: limits.minAverageConfidence });
  for (const route of routes.filter(route => !complete(route))) failures.push({ metric: 'route documentation', route: `${route.method} ${route.path}`, reason: 'summary, description, or response contract is incomplete' });
  return { passed: failures.length === 0, routes: routes.length, documentedRoutes: documentedRoutes.length, coverage, minimumConfidence, averageConfidence, thresholds: limits, failures };
}

module.exports = { evaluateQuality };
