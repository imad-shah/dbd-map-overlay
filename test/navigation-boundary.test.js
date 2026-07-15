'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {buildPlayableBoundary} = require('../src/core/navigation-boundary');
const {constrainPoseToBoundary} = require('../src/core/navigation-math');

function syntheticMap() {
    const width = 64;
    const height = 64;
    const pixels = Buffer.alloc(width * height * 3);
    const paint = (x, y, color) => {
        const offset = (y * width + x) * 3;
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
    };
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) paint(x, y, [40, 42, 70]);
    }

    for (let y = 9; y <= 54; y++) {
        const maxX = y < 38 ? 54 : 28;
        for (let x = 9; x <= maxX; x++) paint(x, y, [140, 150, 225]);
    }
    // A large internal label/building hole should not become an outside boundary.
    for (let y = 22; y <= 32; y++) {
        for (let x = 20; x <= 34; x++) paint(x, y, [0, 0, 0]);
    }
    // Small decorative marks outside the map should be discarded.
    paint(2, 2, [140, 150, 225]);
    paint(2, 3, [140, 150, 225]);
    paint(3, 2, [140, 150, 225]);
    return {pixels, width, height};
}

test('extracts a concave playable silhouette and ignores decorations', () => {
    const {pixels, width, height} = syntheticMap();
    const boundary = buildPlayableBoundary(pixels, width, height);

    assert.ok(boundary);
    assert.ok(boundary.minY > 0.1);
    assert.ok(boundary.rows[2].length === 0);

    const upper = constrainPoseToBoundary({x: 0.5, y: 0.35, heading: 0}, boundary);
    assert.ok(Math.abs(upper.x - 0.5) < 1e-12);

    const notch = constrainPoseToBoundary({x: 0.8, y: 0.7, heading: 0}, boundary);
    assert.ok(notch.x < 0.55);
});

test('fills internal artwork holes while retaining the outside clamp', () => {
    const {pixels, width, height} = syntheticMap();
    const boundary = buildPlayableBoundary(pixels, width, height);
    const insideHole = constrainPoseToBoundary({x: 0.42, y: 0.38, heading: 90}, boundary);
    const aboveMap = constrainPoseToBoundary({x: 0.5, y: 0, heading: 90}, boundary);

    assert.ok(Math.abs(insideHole.x - 0.42) < 1e-12);
    assert.ok(aboveMap.y >= boundary.minY);
});
