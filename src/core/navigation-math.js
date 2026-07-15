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

function constrainPoseToBoundary(pose, boundary) {
    const fallback = {
        ...pose,
        x: clamp(Number(pose.x) || 0, 0, 1),
        y: clamp(Number(pose.y) || 0, 0, 1)
    };
    if (!boundary || !Array.isArray(boundary.rows) || boundary.rows.length < 2) {
        return fallback;
    }

    const lastRow = boundary.rows.length - 1;
    let y = clamp(fallback.y, Number(boundary.minY) || 0, Number(boundary.maxY) || 1);
    let rowIndex = Math.round(y * lastRow);
    let intervals = boundary.rows[rowIndex];
    if (!Array.isArray(intervals) || intervals.length === 0) {
        let nearestIndex = null;
        for (let distance = 1; distance <= lastRow; distance++) {
            for (const candidate of [rowIndex - distance, rowIndex + distance]) {
                if (
                    candidate >= 0 && candidate <= lastRow &&
                    Array.isArray(boundary.rows[candidate]) &&
                    boundary.rows[candidate].length > 0
                ) {
                    nearestIndex = candidate;
                    break;
                }
            }
            if (nearestIndex !== null) break;
        }
        if (nearestIndex === null) return fallback;
        rowIndex = nearestIndex;
        y = rowIndex / lastRow;
        intervals = boundary.rows[rowIndex];
    }

    let x = fallback.x;
    if (!intervals.some(interval => x >= interval.min && x <= interval.max)) {
        let nearestX = x;
        let nearestDistance = Infinity;
        for (const interval of intervals) {
            for (const edge of [interval.min, interval.max]) {
                const distance = Math.abs(x - edge);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestX = edge;
                }
            }
        }
        x = nearestX;
    }

    return {...pose, x, y};
}

/**
 * Applies slow map-relative position and heading corrections to a pose.
 * These controls are independent of the camera-relative WASD movement.
 */
function applyPoseCorrection(
    pose,
    input,
    elapsedSeconds,
    mapUnitsPerSecond,
    degreesPerSecond
) {
    const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
    const positionSpeed = Math.max(0, Number(mapUnitsPerSecond) || 0);
    const headingSpeed = Math.max(0, Number(degreesPerSecond) || 0);
    let horizontal = (input.mapRight ? 1 : 0) - (input.mapLeft ? 1 : 0);
    let vertical = (input.mapDown ? 1 : 0) - (input.mapUp ? 1 : 0);
    const length = Math.hypot(horizontal, vertical);

    if (length > 1) {
        horizontal /= length;
        vertical /= length;
    }

    const turn = (input.turnClockwise ? 1 : 0) - (input.turnCounterclockwise ? 1 : 0);
    return {
        ...pose,
        x: clamp((Number(pose.x) || 0) + horizontal * positionSpeed * elapsed, 0, 1),
        y: clamp((Number(pose.y) || 0) + vertical * positionSpeed * elapsed, 0, 1),
        heading: normalizeHeading((Number(pose.heading) || 0) + turn * headingSpeed * elapsed)
    };
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
    applyPoseCorrection,
    advancePose,
    clamp,
    constrainPoseToBoundary,
    headingFromPoints,
    normalizeHeading
};
