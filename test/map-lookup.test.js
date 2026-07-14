'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {findClosestCreatorMap} = require('../src/js/map-lookup');

const paths = {
    "Hens333/The MacMillan Estate/Suffocation Pit.webp": "/Hens333/The MacMillan Estate/Suffocation Pit.webp",
    "Hens333/Red Forest/Temple of Purgation.webp": "/Hens333/Red Forest/Temple of Purgation.webp",
    "Hens333/Coldwind Farm/Rancid Abbatoir.webp": "/Hens333/Coldwind Farm/Rancid Abbatoir.webp",
    "Other/Red Forest/The Temple of Purgation.png": "/Other/Red Forest/The Temple of Purgation.png"
};

test('matches Hens333 maps by name or complete logical path', () => {
    assert.equal(
        findClosestCreatorMap(paths, 'Suffocation Pit', 'Hens333'),
        paths["Hens333/The MacMillan Estate/Suffocation Pit.webp"]
    );
    assert.equal(
        findClosestCreatorMap(paths, 'hens333/the macmillan estate/suffocation pit', 'Hens333'),
        paths["Hens333/The MacMillan Estate/Suffocation Pit.webp"]
    );
});

test('handles leading articles and small filename typos', () => {
    assert.equal(
        findClosestCreatorMap(paths, 'The Temple of Purgation', 'Hens333'),
        paths["Hens333/Red Forest/Temple of Purgation.webp"]
    );
    assert.equal(
        findClosestCreatorMap(paths, 'Rancid Abattoir', 'Hens333'),
        paths["Hens333/Coldwind Farm/Rancid Abbatoir.webp"]
    );
});

test('does not match realm labels or fall back to other creators', () => {
    assert.equal(findClosestCreatorMap(paths, 'Coldwind Farm', 'Hens333'), null);
    assert.equal(findClosestCreatorMap(paths, 'Unknown Map', 'Hens333'), null);
});
