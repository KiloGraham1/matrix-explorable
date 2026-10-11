/**
 * Pure 2D linear-algebra helpers for the determinant explorer.
 *
 * Convention used everywhere: a 2x2 matrix is described by its two COLUMNS.
 *   c1 = [a, c]  -> where the basis vector (1, 0) lands
 *   c2 = [b, d]  -> where the basis vector (0, 1) lands
 * so the matrix is  A = [[a, b], [c, d]]  and  A·[x, y] = x·c1 + y·c2.
 *
 * Nothing in here touches the DOM or Svelte, so it can be unit tested with
 * plain Node (see tests/linalg2d.test.js).
 */

/** |det| below this is treated as exactly zero (floating point noise). */
export const SINGULAR_EPS = 1e-6;

/** |det| below this (but above SINGULAR_EPS) is "nearly flat". */
export const NEARLY_SINGULAR = 0.1;

/** det [[a, b], [c, d]] = ad - bc, with c1 = [a, c] and c2 = [b, d]. */
export function det2(c1, c2) {
	return c1[0] * c2[1] - c2[0] * c1[1];
}

/** A·p, i.e. x·c1 + y·c2. */
export function applyMatrix(c1, c2, [x, y]) {
	return [x * c1[0] + y * c2[0], x * c1[1] + y * c2[1]];
}

/** Corners of the unit square, counter-clockwise from the origin. */
export const UNIT_SQUARE = [
	[0, 0],
	[1, 0],
	[1, 1],
	[0, 1]
];

/**
 * An asymmetric "F", drawn inside the unit square. A square looks the same
 * when it is mirrored; an F does not, so it shows when orientation flips.
 */
export const F_GLYPH = [
	[0.25, 0.1],
	[0.45, 0.1],
	[0.45, 0.42],
	[0.68, 0.42],
	[0.68, 0.58],
	[0.45, 0.58],
	[0.45, 0.72],
	[0.8, 0.72],
	[0.8, 0.9],
	[0.25, 0.9]
];

/** The unit square after the transformation (a parallelogram, or flatter). */
export function unitSquareImage(c1, c2) {
	return UNIT_SQUARE.map((p) => applyMatrix(c1, c2, p));
}

export function isSingular(det, eps = SINGULAR_EPS) {
	return Math.abs(det) < eps;
}

/**
 * Dimension of the transformation's image:
 * 2 = the plane stays a plane (invertible), 1 = squashed onto a line,
 * 0 = squashed onto a single point.
 */
export function rank(c1, c2, eps = SINGULAR_EPS) {
	if (!isSingular(det2(c1, c2), eps)) return 2;
	const nonzero = (v) => Math.hypot(v[0], v[1]) > eps;
	return nonzero(c1) || nonzero(c2) ? 1 : 0;
}

/** Projection of v onto the line spanned by u (the zero vector if u is zero). */
export function projectOnto(v, u) {
	const uu = u[0] * u[0] + u[1] * u[1];
	if (uu < 1e-12) return [0, 0];
	const k = (v[0] * u[0] + v[1] * u[1]) / uu;
	return [k * u[0], k * u[1]];
}

/**
 * Where to move c2 so the matrix becomes singular: onto the line through c1.
 * (If c1 is zero the matrix is already singular, so c2 stays put.)
 */
export function squashTarget(c1, c2) {
	if (Math.hypot(c1[0], c1[1]) < 1e-9) return [...c2];
	return projectOnto(c2, c1);
}

export function lerp2(p, q, t) {
	return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
}

export function clamp(v, lo, hi) {
	return Math.min(hi, Math.max(lo, v));
}

/** Round to the nearest multiple of step. The `+ 0` turns -0 into 0. */
export function snapTo(v, step) {
	return Math.round(v / step) * step + 0;
}

/**
 * For a matrix that squashes the plane onto a line (rank 1): the unit
 * direction along which inputs get sent to the origin (the "kernel" or null
 * space). Every input on this line lands on the same output, which is exactly
 * why the map cannot be undone. Returns null when the matrix is invertible
 * (nothing but the origin is sent to the origin) or when it is the zero matrix
 * (every input is sent to the origin, so there is no single direction).
 */
export function kernelDirection(c1, c2, eps = SINGULAR_EPS) {
	if (rank(c1, c2, eps) !== 1) return null;
	let k;
	if (Math.hypot(c1[0], c1[1]) > eps) {
		// c2 = lambda * c1, so A·(lambda, -1) = lambda·c1 - c2 = 0
		const lambda =
			(c2[0] * c1[0] + c2[1] * c1[1]) / (c1[0] * c1[0] + c1[1] * c1[1]);
		k = [lambda, -1];
	} else {
		// c1 = 0, so A·(1, 0) = 0
		k = [1, 0];
	}
	const len = Math.hypot(k[0], k[1]);
	return [k[0] / len, k[1] / len];
}

/**
 * The transformed integer grid: the images of the lines x = k and y = k for
 * k in -n..n, each as a segment from p0 to p1.
 */
export function gridLines(c1, c2, n) {
	const lines = [];
	for (let k = -n; k <= n; k++) {
		lines.push({
			axis: "x",
			k,
			p0: applyMatrix(c1, c2, [k, -n]),
			p1: applyMatrix(c1, c2, [k, n])
		});
		lines.push({
			axis: "y",
			k,
			p0: applyMatrix(c1, c2, [-n, k]),
			p1: applyMatrix(c1, c2, [n, k])
		});
	}
	return lines;
}

/** Number for display: fixed decimals, a real minus sign, never "-0.00". */
export function formatNum(x, digits = 2) {
	const v = Math.abs(x) < 0.5 * 10 ** -digits ? 0 : x;
	return v.toFixed(digits).replace("-", "−");
}

/**
 * The columns of the inverse matrix, or null if there is no inverse.
 * The inverse sends c1 back to (1, 0) and c2 back to (0, 1), and it scales
 * area by 1/det.
 */
export function inverseColumns(c1, c2, eps = SINGULAR_EPS) {
	const d = det2(c1, c2);
	if (isSingular(d, eps)) return null;
	return [
		[c2[1] / d, -c1[1] / d],
		[-c2[0] / d, c1[0] / d]
	];
}

/**
 * "Which inputs does this matrix send to the output q?"  This is the question
 * of undoing the map at q. The answer has one of four shapes:
 *
 *  { kind: "one",  p }            invertible: exactly one input, p = A^-1 q
 *  { kind: "line", p, dir }       rank 1 and q on the image line: every input
 *                                 p + t*dir lands on q (dir is the kernel)
 *  { kind: "none" }               q is not in the image: no input reaches it
 *  { kind: "all" }                zero matrix and q = 0: every input works
 *
 * For rank 1, p is the input closest to the origin among the answers.
 */
export function preimage(c1, c2, q, eps = SINGULAR_EPS) {
	const inv = inverseColumns(c1, c2, eps);
	if (inv) return { kind: "one", p: applyMatrix(inv[0], inv[1], q) };

	const r = rank(c1, c2, eps);
	if (r === 0) {
		return Math.hypot(q[0], q[1]) < eps ? { kind: "all" } : { kind: "none" };
	}

	// rank 1: the image is the line through the origin along u (a nonzero column)
	const useFirst = Math.hypot(c1[0], c1[1]) > eps;
	const u = useFirst ? c1 : c2;
	const uu = u[0] * u[0] + u[1] * u[1];
	const s = (q[0] * u[0] + q[1] * u[1]) / uu; // q's coordinate along u
	const miss = Math.hypot(q[0] - s * u[0], q[1] - s * u[1]); // distance to the line
	if (miss > eps) return { kind: "none" };

	const dir = kernelDirection(c1, c2, eps);
	// A particular solution, then slide along dir to the point nearest the origin.
	let p = useFirst ? [s, 0] : [0, s];
	const along = p[0] * dir[0] + p[1] * dir[1];
	p = [p[0] - along * dir[0], p[1] - along * dir[1]];
	return { kind: "line", p, dir };
}

/**
 * Pick the point of a preimage() answer that is closest to p. For "one" this
 * is the single answer, for "line" it is p projected onto the line, otherwise
 * p is returned unchanged. Used to keep the input marker steady while the
 * output marker is dragged.
 */
export function closestOnSolution(sol, p) {
	if (sol.kind === "one") return [...sol.p];
	if (sol.kind === "line") {
		const t = (p[0] - sol.p[0]) * sol.dir[0] + (p[1] - sol.p[1]) * sol.dir[1];
		return [sol.p[0] + t * sol.dir[0], sol.p[1] + t * sol.dir[1]];
	}
	return [...p];
}
