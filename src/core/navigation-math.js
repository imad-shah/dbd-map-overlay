'use strict';

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeHeading(degrees) {
    const normalized = Number(degrees) % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}

function headingFromPoints(origin, target) {
    const dx = Number(target.x) - Number(origin.x);
    const dy = Number(target.y) - Number(origin.y);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 0.001) {
        return null;
    }
    return normalizeHeading(Math.atan2(dx, -dy) * 180 / Math.PI);
}

function applyHeadingDelta(heading, mouseDeltaX, degreesPerMouseUnit) {
    const delta = (Number(mouseDeltaX) || 0) * Math.max(0, Number(degreesPerMouseUnit) || 0);
    return normalizeHeading((Number(heading) || 0) + delta);
}

/**
 * Advances a normalized map pose from camera-relative movement input.
 * Heading is clockwise from the top of the map; x/y are in the [0, 1] range.
 */
function advancePose(pose, input, elapsedSeconds, mapUnitsPerSecond) {
    const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
    const speed = Math.max(0, Number(mapUnitsPerSecond) || 0);
    let forward = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
    let right = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const length = Math.hypot(forward, right);

    if (length > 1) {
        forward /= length;
        right /= length;
    }

    const heading = normalizeHeading(pose.heading || 0);
    const radians = heading * Math.PI / 180;
    const east = right * Math.cos(radians) + forward * Math.sin(radians);
    const north = forward * Math.cos(radians) - right * Math.sin(radians);
    const distance = speed * elapsed;

    return {
        ...pose,
        x: clamp((Number(pose.x) || 0) + east * distance, 0, 1),
        y: clamp((Number(pose.y) || 0) - north * distance, 0, 1),
        heading
    };
}

module.exports = {
    applyHeadingDelta,
    advancePose,
    clamp,
    headingFromPoints,
    normalizeHeading
};
