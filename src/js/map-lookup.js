'use strict';

function normalizeMapName(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\.[^/.]+$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/^the\s+/, '')
        .trim();
}

function levenshteinDistance(a, b) {
    const rows = Array.from({length: a.length + 1}, (_, index) => [index]);
    for (let column = 0; column <= b.length; column++) rows[0][column] = column;
    for (let row = 1; row <= a.length; row++) {
        for (let column = 1; column <= b.length; column++) {
            rows[row][column] = a[row - 1] === b[column - 1]
                ? rows[row - 1][column - 1]
                : 1 + Math.min(
                    rows[row - 1][column],
                    rows[row][column - 1],
                    rows[row - 1][column - 1]
                );
        }
    }
    return rows[a.length][b.length];
}

function findClosestCreatorMap(pathLookup, mapKey, creator) {
    if (typeof mapKey !== 'string' || mapKey.trim().length === 0) return null;

    const slashKey = mapKey.replace(/\\/g, '/').trim();
    const fullQuery = slashKey.replace(/\.[^.]+$/, '').toLowerCase();
    const mapQuery = normalizeMapName(slashKey.split('/').at(-1));
    if (!mapQuery) return null;

    const creatorPrefix = `${String(creator).toLowerCase()}/`;
    const allowedKeys = Object.keys(pathLookup).filter(key => (
        key.toLowerCase().startsWith(creatorPrefix)
    ));

    const exactPath = allowedKeys.find(key => (
        key.replace(/\.[^.]+$/, '').toLowerCase() === fullQuery
    ));
    if (exactPath) return pathLookup[exactPath];

    const exactName = allowedKeys.find(key => (
        normalizeMapName(key.split('/').at(-1)) === mapQuery
    ));
    if (exactName) return pathLookup[exactName];

    const partialName = allowedKeys.find(key => {
        const candidate = normalizeMapName(key.split('/').at(-1));
        return candidate.includes(mapQuery) || mapQuery.includes(candidate);
    });
    if (partialName) return pathLookup[partialName];

    const maxDistance = Math.max(2, Math.floor(mapQuery.length * 0.18));
    let best = null;
    let bestDistance = maxDistance + 1;
    for (const key of allowedKeys) {
        const candidate = normalizeMapName(key.split('/').at(-1));
        if (Math.abs(candidate.length - mapQuery.length) > maxDistance) continue;
        const candidateDistance = levenshteinDistance(candidate, mapQuery);
        if (candidateDistance < bestDistance) {
            best = key;
            bestDistance = candidateDistance;
        }
    }
    return bestDistance <= maxDistance ? pathLookup[best] : null;
}

module.exports = {
    findClosestCreatorMap,
    levenshteinDistance,
    normalizeMapName
};
