'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const NavigationTracker = require('../src/core/navigation-tracker');

function createTracker() {
    const messages = [];
    const input = {
        started: false,
        starts: 0,
        stops: 0,
        start() {
            this.started = true;
            this.starts++;
        },
        stop() {
            this.started = false;
            this.stops++;
        }
    };
    const mainWindow = {
        send: (event, data) => messages.push({target: 'main', event, data}),
        sendUpdate: message => messages.push({target: 'update', message})
    };
    const overlayWindow = {
        beginInteraction: () => true,
        endInteraction: () => {},
        send: (event, data) => messages.push({target: 'overlay', event, data})
    };
    const values = {
        navigationMoveSpeed: 0.1,
        navigationMouseSensitivity: 1
    };
    const settings = {get: key => values[key]};
    const ipc = {handle: () => {}};
    const tracker = new NavigationTracker(mainWindow, overlayWindow, settings, input, ipc);
    return {input, messages, tracker};
}

test('calibration starts input tracking and live ticks update heading and position', () => {
    const {input, tracker} = createTracker();
    tracker.setMap('/Hens333/Red Forest/Mothers Dwelling.webp');
    assert.equal(tracker.startCalibration().ok, true);

    const committed = tracker.commitCalibration({x: 0.5, y: 0.5, heading: 0});
    assert.equal(committed.ok, true);
    assert.equal(committed.trackingStarted, true);
    assert.equal(input.started, true);
    clearInterval(tracker.trackingTimer);
    tracker.trackingTimer = null;

    tracker.pendingMouseX = 10;
    tracker.movement = {forward: true, backward: false, left: false, right: false};
    tracker.lastTickAt = performance.now() - 100;
    tracker._tick();

    const state = tracker.getState();
    assert.equal(state.heading, 10);
    assert.ok(state.position.x > 0.5);
    assert.ok(state.position.y < 0.5);

    const paused = tracker.toggleTracking();
    assert.equal(paused.tracking, false);
    assert.equal(input.started, false);
    tracker.destroy();
});

test('canceling recalibration resumes a previously active tracker', () => {
    const {input, tracker} = createTracker();
    tracker.setMap('/Hens333/Red Forest/Mothers Dwelling.webp');
    tracker.startCalibration();
    tracker.commitCalibration({x: 0.5, y: 0.5, heading: 90});
    clearInterval(tracker.trackingTimer);
    tracker.trackingTimer = null;

    tracker.startCalibration();
    assert.equal(input.started, false);
    tracker.cancelCalibration();
    assert.equal(tracker.getState().tracking, true);
    assert.equal(input.started, true);
    tracker.destroy();
});

test('hiding a map releases global input and showing it resumes the prior tracker', () => {
    const {input, tracker} = createTracker();
    const map = '/Hens333/Red Forest/Mothers Dwelling.webp';
    tracker.setMap(map);
    tracker.startCalibration();
    tracker.commitCalibration({x: 0.4, y: 0.6, heading: 90});

    tracker.setMap('');
    assert.equal(tracker.getState().tracking, false);
    assert.deepEqual(tracker.getState().position, {x: 0.4, y: 0.6});
    assert.equal(input.started, false);
    assert.equal(tracker.startCalibration().reason, 'no-hens333-map');
    assert.equal(tracker.toggleTracking().reason, 'map-hidden');

    tracker.setMap(map);
    assert.equal(tracker.getState().tracking, true);
    assert.equal(input.started, true);
    tracker.destroy();
});

test('calibration is clamped to the extracted playable map boundary', () => {
    const {tracker} = createTracker();
    const map = '/Hens333/Red Forest/Mothers Dwelling.webp';
    const rows = Array.from({length: 5}, () => [{min: 0.2, max: 0.8}]);
    tracker.setMap(map);
    assert.equal(tracker.setPlayableBoundary(map, {rows, minY: 0.25, maxY: 0.75}), true);
    tracker.startCalibration();
    tracker.commitCalibration({x: 0.95, y: 0.05, heading: 0});

    assert.deepEqual(tracker.getState().position, {x: 0.8, y: 0.25});
    tracker.destroy();
});
