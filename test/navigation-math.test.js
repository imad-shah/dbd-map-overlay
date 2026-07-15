'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    applyHeadingDelta,
    applyPoseCorrection,
    advancePose,
    constrainPoseToBoundary,
    headingFromPoints,
    normalizeHeading
} = require('../src/core/navigation-math');
const {
    cursorWrapTarget,
    navigationKeyMap,
    NavigationInput,
    mouseDeltaFromPositions
} = require('../src/core/navigation-input');

test('normalizes headings to clockwise degrees', () => {
    assert.equal(normalizeHeading(370), 10);
    assert.equal(normalizeHeading(-90), 270);
});

test('derives heading clockwise from map north', () => {
    const origin = {x: 0.5, y: 0.5};
    assert.equal(headingFromPoints(origin, {x: 0.5, y: 0.1}), 0);
    assert.equal(headingFromPoints(origin, {x: 0.9, y: 0.5}), 90);
    assert.equal(headingFromPoints(origin, origin), null);
});

test('turns clockwise from positive horizontal mouse motion', () => {
    assert.equal(applyHeadingDelta(350, 20, 1), 10);
    assert.equal(applyHeadingDelta(10, -20, 1), 350);
});

test('applies map-relative position and heading corrections', () => {
    const corrected = applyPoseCorrection(
        {x: 0.5, y: 0.5, heading: 5},
        {mapUp: true, mapLeft: true, turnCounterclockwise: true},
        1,
        0.02,
        15
    );

    assert.ok(corrected.x < 0.5);
    assert.ok(corrected.y < 0.5);
    assert.equal(corrected.heading, 350);
});

test('normalizes fine corrections and cancels opposing controls', () => {
    const corrected = applyPoseCorrection(
        {x: 0.99, y: 0.01, heading: 45},
        {
            mapUp: true,
            mapDown: true,
            mapLeft: true,
            mapRight: true,
            turnCounterclockwise: true,
            turnClockwise: true
        },
        1,
        1,
        90
    );

    assert.deepEqual(corrected, {x: 0.99, y: 0.01, heading: 45});
});

test('derives mouse deltas while rejecting cursor warps', () => {
    assert.deepEqual(
        mouseDeltaFromPositions({x: 100, y: 200}, {x: 112, y: 197}),
        {dx: 12, dy: -3}
    );
    assert.equal(mouseDeltaFromPositions(null, {x: 10, y: 10}), null);
    assert.equal(mouseDeltaFromPositions({x: 0, y: 0}, {x: 500, y: 0}), null);
});

test('wraps either horizontal screen edge back to the display center', () => {
    const bounds = {x: 0, y: 0, width: 1000, height: 800};
    assert.deepEqual(cursorWrapTarget({x: 20, y: 300}, bounds), {x: 500, y: 300});
    assert.deepEqual(cursorWrapTarget({x: 980, y: 300}, bounds), {x: 500, y: 300});
    assert.equal(cursorWrapTarget({x: 400, y: 300}, bounds), null);
});

test('ignores the synthetic center event after wrapping the cursor', () => {
    const deltas = [];
    const moves = [];
    const input = new NavigationInput({
        onMouseDelta: (dx, dy) => deltas.push({dx, dy}),
        cursor: {moveTo: (x, y) => (moves.push({x, y}), true)},
        getBoundsForPoint: () => ({x: 0, y: 0, width: 1000, height: 800})
    });

    input._handleMouse({x: 100, y: 300});
    input._handleMouse({x: 63, y: 300});
    input._handleMouse({x: 500, y: 300});
    input._handleMouse({x: 490, y: 300});

    assert.deepEqual(moves, [{x: 500, y: 300}]);
    assert.deepEqual(deltas, [{dx: -37, dy: 0}, {dx: -10, dy: 0}]);
});

test('maps fine calibration keys to map-relative corrections', () => {
    const keyMap = navigationKeyMap({
        W: 1,
        S: 2,
        A: 3,
        D: 4,
        I: 5,
        J: 6,
        K: 7,
        L: 8,
        O: 9,
        P: 10
    });

    assert.equal(keyMap.get(5), 'mapUp');
    assert.equal(keyMap.get(6), 'mapLeft');
    assert.equal(keyMap.get(7), 'mapDown');
    assert.equal(keyMap.get(8), 'mapRight');
    assert.equal(keyMap.get(9), 'turnCounterclockwise');
    assert.equal(keyMap.get(10), 'turnClockwise');
});

test('moves forward relative to heading', () => {
    const north = advancePose(
        {x: 0.5, y: 0.5, heading: 0},
        {forward: true},
        1,
        0.1
    );
    assert.equal(north.x, 0.5);
    assert.equal(north.y, 0.4);

    const east = advancePose(
        {x: 0.5, y: 0.5, heading: 90},
        {forward: true},
        1,
        0.1
    );
    assert.ok(Math.abs(east.x - 0.6) < 1e-12);
    assert.ok(Math.abs(east.y - 0.5) < 1e-12);
});

test('normalizes diagonal movement and clamps map bounds', () => {
    const pose = advancePose(
        {x: 0.99, y: 0.01, heading: 0},
        {forward: true, right: true},
        1,
        1
    );
    assert.equal(pose.x, 1);
    assert.equal(pose.y, 0);
});

test('clamps a pose to the nearest interval in a concave boundary row', () => {
    const boundary = {
        minY: 0,
        maxY: 1,
        rows: [
            [{min: 0.1, max: 0.9}],
            [{min: 0.1, max: 0.4}, {min: 0.7, max: 0.9}],
            [{min: 0.2, max: 0.8}]
        ]
    };

    assert.deepEqual(
        constrainPoseToBoundary({x: 0.6, y: 0.5, heading: 12}, boundary),
        {x: 0.7, y: 0.5, heading: 12}
    );
});
