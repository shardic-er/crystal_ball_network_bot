/**
 * Timing utilities for delay and performance profiling
 */

// Utility: delay helper to reduce boilerplate
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Timing utility for performance profiling
const timings = {};

function startTiming(label) {
  timings[label] = Date.now();
}

function endTiming(label) {
  if (!timings[label]) {
    console.log(`[TIMING] WARNING: No start time for "${label}"`);
    return 0;
  }
  const elapsed = Date.now() - timings[label];
  console.log(`[TIMING] ${label}: ${elapsed}ms`);
  delete timings[label];
  return elapsed;
}

module.exports = {
  delay,
  startTiming,
  endTiming
};
