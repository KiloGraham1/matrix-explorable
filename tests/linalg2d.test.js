import { test } from "node:test";
import assert from "node:assert/strict";
import {
	det2,
	applyMatrix,
	unitSquareImage,
	isSingular,
	rank,
	projectOnto,
	squashTarget,
	lerp2,
	clamp,
	snapTo,
	kernelDirection,
	gridLines,
	formatNum,
	F_GLYPH
} from "../src/utils/linalg2d.js";

// Deterministic pseudo-random numbers so failures are reproducible.
function mulberry32(seed) {
	return function () {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rand = mulberry32(375);
const randCol = () => [rand() * 8 - 4, rand() * 8 - 4];

// Shoelace formula: signed area of a polygon given as [[x, y], ...].
function shoelace(poly) {
	let s = 0;
	for (let i = 0; i < poly.length; i++) {
		const [x1, y1] = poly[i];
		const [x2, y2] = poly[(i + 1) % poly.length];
		s += x1 * y2 - x2 * y1;
	}
	return s / 2;
}

test("determinant of known matrices", () => {
	assert.equal(det2([1, 0], [0, 1]), 1); // identity
	assert.equal(det2([1, -2], [2, 0]), 4); // the explainer's example: [[1,2],[-2,0]]
	assert.equal(det2([1, 0], [0, -1]), -1); // mirror
	assert.equal(det2([0, 1], [-1, 0]), 1); // 90 degree rotation
	assert.equal(det2([1, 0], [1, 1]), 1); // shear keeps area
	assert.equal(det2([1, 2], [2, 4]), 0); // columns are parallel
});

test("matrix-vector product matches the explainer's worked example", () => {
	// [[1, 2], [-2, 0]] . [-1, 2] = [3, 2]
	assert.deepEqual(applyMatrix([1, -2], [2, 0], [-1, 2]), [3, 2]);
});

test("columns are where the basis vectors land", () => {
	const c1 = [3, -1];
	const c2 = [0.5, 2];
	assert.deepEqual(applyMatrix(c1, c2, [1, 0]), c1);
	assert.deepEqual(applyMatrix(c1, c2, [0, 1]), c2);
});

test("area of the transformed unit square equals |det| (signed area equals det)", () => {
	for (let i = 0; i < 500; i++) {
		const c1 = randCol();
		const c2 = randCol();
		const area = shoelace(unitSquareImage(c1, c2));
		assert.ok(Math.abs(area - det2(c1, c2)) < 1e-9, `iteration ${i}`);
	}
});

test("every region scales by det, not just the unit square", () => {
	const c1 = [1.5, -0.5];
	const c2 = [0.25, 2];
	const rect = [
		[0, 0],
		[3, 0],
		[3, 2],
		[0, 2]
	]; // area 6
	const image = rect.map((p) => applyMatrix(c1, c2, p));
	assert.ok(Math.abs(shoelace(image) - 6 * det2(c1, c2)) < 1e-9);
});

test("a negative determinant means the orientation flipped", () => {
	const square = unitSquareImage([1, 0], [0, -1]);
	assert.ok(shoelace(square) < 0);
	const f = F_GLYPH.map((p) => applyMatrix([1, 0], [0, -1], p));
	assert.ok(shoelace(f) * shoelace(F_GLYPH) < 0); // sign of area flips
});

test("singular detection and rank", () => {
	assert.equal(isSingular(0), true);
	assert.equal(isSingular(1e-9), true);
	assert.equal(isSingular(0.05), false);
	assert.equal(rank([1, 0], [0, 1]), 2);
	assert.equal(rank([1, 2], [2, 4]), 1); // flattened onto a line
	assert.equal(rank([0, 0], [0, 0]), 0); // flattened onto a point
	assert.equal(rank([0, 0], [3, 1]), 1);
});

test("squashTarget always produces a singular matrix", () => {
	for (let i = 0; i < 500; i++) {
		const c1 = randCol();
		const c2 = randCol();
		const target = squashTarget(c1, c2);
		assert.ok(isSingular(det2(c1, target)), `iteration ${i}`);
	}
});

test("squashing shrinks the determinant linearly to zero", () => {
	const c1 = [1, -2];
	const c2 = [2, 0];
	const target = squashTarget(c1, c2);
	const d0 = det2(c1, c2);
	for (const t of [0, 0.25, 0.5, 0.75, 1]) {
		const d = det2(c1, lerp2(c2, target, t));
		assert.ok(Math.abs(d - d0 * (1 - t)) < 1e-9, `t=${t}`);
	}
});

test("squashTarget leaves an already-singular matrix alone", () => {
	assert.deepEqual(squashTarget([0, 0], [3, 1]), [3, 1]);
});

test("projectOnto", () => {
	assert.deepEqual(projectOnto([2, 2], [1, 0]), [2, 0]);
	assert.deepEqual(projectOnto([2, 2], [0, 0]), [0, 0]);
});

test("snapTo rounds to the grid and never returns -0", () => {
	assert.equal(snapTo(1.26, 0.5), 1.5);
	assert.equal(snapTo(1.24, 0.5), 1);
	assert.ok(Object.is(snapTo(-0.2, 0.5), 0));
	assert.equal(snapTo(-1.3, 0.5), -1.5);
});

test("clamp", () => {
	assert.equal(clamp(9, -4, 4), 4);
	assert.equal(clamp(-9, -4, 4), -4);
	assert.equal(clamp(1, -4, 4), 1);
});

test("kernelDirection: the line of inputs that all land on the origin", () => {
	// [[1,2],[2,4]]: (2, -1) is sent to (0, 0), so the kernel is along (2, -1)/sqrt(5).
	const k = kernelDirection([1, 2], [2, 4]);
	assert.ok(Math.abs(Math.hypot(k[0], k[1]) - 1) < 1e-12);
	const out = applyMatrix([1, 2], [2, 4], k);
	assert.ok(Math.abs(out[0]) < 1e-12 && Math.abs(out[1]) < 1e-12);

	// First column zero: the x-axis direction is sent to the origin.
	assert.deepEqual(kernelDirection([0, 0], [3, 1]), [1, 0]);

	// Invertible matrices and the zero matrix have no single kernel direction.
	assert.equal(kernelDirection([1, -2], [2, 0]), null);
	assert.equal(kernelDirection([0, 0], [0, 0]), null);
});

test("kernelDirection works for every matrix squashTarget produces", () => {
	for (let i = 0; i < 500; i++) {
		const c1 = randCol();
		const c2 = squashTarget(c1, randCol());
		const k = kernelDirection(c1, c2);
		assert.ok(k, `iteration ${i}`);
		const out = applyMatrix(c1, c2, k);
		assert.ok(Math.hypot(out[0], out[1]) < 1e-9, `iteration ${i}`);
	}
});

test("a squashed matrix sends different inputs to the same output", () => {
	// Two different inputs that differ by a multiple of the kernel direction
	// land on exactly the same point: many-to-one, so no inverse can exist.
	const c1 = [1, -2];
	const c2 = squashTarget(c1, [2, 0]);
	const k = kernelDirection(c1, c2);
	const p = [1, 1];
	const q = [p[0] + 3 * k[0], p[1] + 3 * k[1]];
	const a = applyMatrix(c1, c2, p);
	const b = applyMatrix(c1, c2, q);
	assert.ok(Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9);
});

test("an invertible matrix scales area back by 1/det", () => {
	const c1 = [1, -2];
	const c2 = [2, 0];
	const d = det2(c1, c2);
	// inverse = (1/det) [[d, -b], [-c, a]]  with c1 = [a, c], c2 = [b, d]
	const inv1 = [c2[1] / d, -c1[1] / d];
	const inv2 = [-c2[0] / d, c1[0] / d];
	assert.ok(Math.abs(det2(inv1, inv2) - 1 / d) < 1e-12);
	// and it really undoes the map
	const p = [-1, 2];
	const back = applyMatrix(inv1, inv2, applyMatrix(c1, c2, p));
	assert.ok(
		Math.abs(back[0] - p[0]) < 1e-12 && Math.abs(back[1] - p[1]) < 1e-12
	);
});

test("gridLines returns two families of 2n+1 lines", () => {
	const lines = gridLines([1, 0], [0, 1], 3);
	assert.equal(lines.length, 14);
	// Identity leaves the lines where they were: x = 2 runs from (2, -3) to (2, 3).
	const xLine = lines.find((l) => l.axis === "x" && l.k === 2);
	assert.deepEqual(xLine.p0, [2, -3]);
	assert.deepEqual(xLine.p1, [2, 3]);
});

test("formatNum", () => {
	assert.equal(formatNum(4), "4.00");
	assert.equal(formatNum(-2), "−2.00");
	assert.equal(formatNum(-0.0000001), "0.00");
	assert.equal(formatNum(0.5, 1), "0.5");
});
