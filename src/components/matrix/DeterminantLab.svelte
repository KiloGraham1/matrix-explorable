<script>
	import { onDestroy } from "svelte";
	import { Grab, Play, MousePointerClick, Undo2 } from "lucide-svelte";
	import Tex from "./Tex.svelte";
	import B from "./B.svelte";
	import Action from "./Action.svelte";
	import ActionIcon from "./ActionIcon.svelte";
	import {
		colorX,
		colorY,
		colorZ,
		colorVector,
		colorGrid,
		colorGridAlt,
		colorB2
	} from "$data/variables";
	import {
		det2,
		applyMatrix,
		unitSquareImage,
		isSingular,
		rank,
		squashTarget,
		lerp2,
		clamp,
		snapTo,
		gridLines,
		preimage,
		closestOnSolution,
		formatNum,
		F_GLYPH,
		UNIT_SQUARE,
		NEARLY_SINGULAR
	} from "$utils/linalg2d.js";

	// ---- Constants -------------------------------------------------------

	// Starting matrix, given by its columns: where (1, 0) and (0, 1) land.
	// The default is the example matrix from the explainer, [[1, 2], [-2, 0]],
	// whose determinant is 4. "Reset" returns to it.
	export let start1 = [1, -2];
	export let start2 = [2, 0];

	const EXAMPLE = { c1: [...start1], c2: [...start2] };
	const IDENTITY = { c1: [1, 0], c2: [0, 1] };

	const PRESETS = [
		{ label: "Identity", ...IDENTITY },
		{ label: "Stretch", c1: [2, 0], c2: [0, 1.5] },
		{ label: "Rotate", c1: [0, 1], c2: [-1, 0] },
		{ label: "Shear", c1: [1, 0], c2: [1, 1] },
		{ label: "Mirror", c1: [1, 0], c2: [0, -1] },
		{ label: "Collapse", c1: [1, 2], c2: [2, 4] }
	];

	const VIEW = 5; // each plane shows -VIEW..VIEW on both axes
	const LIMIT = 4.5; // handles stay inside the visible plane
	const STEP = 0.5; // snapping step
	const GRID_N = 12; // transformed grid spans -GRID_N..GRID_N
	const BAR_MAX = 8; // the area bar is full at this area

	const colorWarn = "#ff5555"; // collapsed / unreachable
	const colorMany = "#f1fa8c"; // the line of inputs that share one output
	const colorProbe = "#50fa7b"; // the point you ask about

	const range = Array.from({ length: 2 * VIEW + 1 }, (_, i) => i - VIEW);

	// ---- State -----------------------------------------------------------

	let c1 = [...EXAMPLE.c1]; // where (1, 0) lands: first column
	let c2 = [...EXAMPLE.c2]; // where (0, 1) lands: second column

	// The probe: an input point p and the output point q it lands on. The
	// explainer's own example, [[1,2],[-2,0]] · (-1, 2) = (3, 2).
	// mode "in":  you are dragging inputs, so q = A·p follows along.
	// mode "out": you are dragging outputs, so q is fixed and we ask which
	//             inputs land on it.
	let p = [-1, 2];
	let q = [3, 2];
	let mode = "in";

	let snapOn = true;
	let dragging = ""; // "", "c1", "c2", "p" or "q"
	let animating = false;
	let saved = null; // the matrix before "Undo it", so it can be put back
	let svgIn;
	let svgOut;
	let raf = 0;

	// ---- Derived values --------------------------------------------------

	$: det = det2(c1, c2);
	$: singular = isSingular(det);
	$: nearly = !singular && Math.abs(det) < NEARLY_SINGULAR;
	$: flipped = !singular && det < 0;
	$: rk = rank(c1, c2);
	$: atIdentity =
		Math.abs(c1[0] - 1) +
			Math.abs(c1[1]) +
			Math.abs(c2[0]) +
			Math.abs(c2[1] - 1) <
		1e-6;

	$: if (mode === "in") q = applyMatrix(c1, c2, p);
	// Which inputs land on q? (one point / a whole line / nothing / everything)
	$: sources = preimage(c1, c2, q);
	// Where to draw the input marker: on the answer set if there is one.
	$: pShown = closestOnSolution(sources, p);

	$: corners = unitSquareImage(c1, c2);
	$: fGlyph = F_GLYPH.map((pt0) => applyMatrix(c1, c2, pt0));
	$: lines = gridLines(c1, c2, GRID_N);

	// The only places the matrix can reach when it is flat: a line (or a point).
	$: imageDir = (() => {
		if (rk !== 1) return null;
		const u = Math.hypot(c1[0], c1[1]) > 1e-6 ? c1 : c2;
		const len = Math.hypot(u[0], u[1]);
		return [u[0] / len, u[1] / len];
	})();

	$: accent = singular ? colorWarn : flipped ? colorZ : colorVector;
	$: barPct = Math.min(Math.abs(det) / BAR_MAX, 1) * 100;
	$: pOffscreen = Math.max(Math.abs(pShown[0]), Math.abs(pShown[1])) > VIEW;
	// When the answer is off the edge of the plane, point toward it.
	$: edge = (() => {
		const m = Math.max(Math.abs(pShown[0]), Math.abs(pShown[1]));
		if (m <= VIEW) return null;
		const k = (VIEW - 0.7) / m;
		return {
			x: pShown[0] * k,
			y: pShown[1] * k,
			angle: (Math.atan2(-pShown[1], pShown[0]) * 180) / Math.PI
		};
	})();

	$: status = singular
		? "Singular: no inverse"
		: nearly
		? "Nearly flat: inverse is extreme"
		: flipped
		? "Invertible, but flipped"
		: "Invertible";

	$: inverseScale = singular
		? "1 / 0, which is impossible"
		: `1 / ${formatNum(Math.abs(det))} = ${formatNum(1 / Math.abs(det))}`;

	// One sentence that answers: "what happens if I try to go backwards from
	// the green dot on the right?"
	$: verdict =
		sources.kind === "one"
			? {
					tone: colorProbe,
					head: "One answer.",
					body: pOffscreen
						? "Exactly one input lands on this output, so it can be traced back. Here it is far away, off the edge of the left plane: the closer the matrix is to flat, the further away the source."
						: "Exactly one input lands on this output, so you can always trace it back."
			  }
			: sources.kind === "line"
			? {
					tone: colorMany,
					head: "Many answers.",
					body: "Every input on the yellow line lands on this same output. Going backwards, there is no way to know which one you started from."
			  }
			: sources.kind === "all"
			? {
					tone: colorMany,
					head: "Every input.",
					body: "This matrix crushes the whole plane onto the origin, so every input lands here."
			  }
			: {
					tone: colorWarn,
					head: "No answer.",
					body:
						rk === 0
							? "The matrix crushes everything onto the origin, so no input lands anywhere else."
							: "No input lands here. The matrix flattened the plane onto the red line, and this point is not on it."
			  };

	$: story = singular
		? rk === 0
			? "Both arrows have length zero, so the entire plane is crushed onto a single point. Every input lands in the same place."
			: "The two arrows lie along one line, so the unit square has been squashed completely flat and its area is 0. The whole plane now lands on the red dashed line on the right. Drag the green dot onto that line and a whole line of inputs lights up on the left; drag it anywhere else and nothing does. Many inputs share each output, and some outputs have no input at all, which is why a matrix with determinant 0 has no inverse."
		: nearly
		? "The square is almost flat. An inverse still exists, but it would have to stretch space enormously to undo this squashing, so tiny errors get blown up. Computers struggle with matrices like this."
		: flipped
		? "The area of the shaded parallelogram is the size of the determinant, but the sign is negative: the F has been mirrored, so space was flipped over. This is still invertible, because the inverse just flips it back."
		: "The unit square became a parallelogram whose area is the determinant. Each output came from exactly one input, so the transformation can be undone by rescaling area by 1 / determinant.";

	// ---- Drawing helpers (math coordinates -> SVG coordinates) -----------

	// SVG's y axis points down, so flip the sign of y.
	const pt = (v) => `${v[0]},${-v[1]}`;
	$: squarePoints = corners.map(pt).join(" ");
	$: fPoints = fGlyph.map(pt).join(" ");
	const inSquarePoints = UNIT_SQUARE.map(pt).join(" ");
	const inFPoints = F_GLYPH.map(pt).join(" ");

	// Labels sit above a handle in the upper half and below it in the lower
	// half, unless that would push the text off the edge of the plane.
	const labelAbove = (c) => (c[1] >= 0 ? c[1] <= 4 : c[1] < -4);
	const labelX = (c) => (c[0] > 2 ? c[0] - 0.3 : c[0] + 0.3);
	const labelY = (c) => (labelAbove(c) ? -c[1] - 0.3 : -c[1] + 0.55);
	const labelAnchor = (c) => (c[0] > 2 ? "end" : "start");
	const coord = (c) => `(${formatNum(c[0], 1)}, ${formatNum(c[1], 1)})`;

	// ---- Interaction -----------------------------------------------------

	function tidy(v) {
		return snapOn ? snapTo(v, STEP) : Math.round(v * 100) / 100 + 0;
	}

	// Pointer position in plane (math) coordinates, for either plane.
	function toMath(evt, el) {
		if (!el) return null;
		const ctm = el.getScreenCTM();
		if (!ctm) return null;
		const point = el.createSVGPoint();
		point.x = evt.clientX;
		point.y = evt.clientY;
		const r = point.matrixTransform(ctm.inverse());
		return [r.x, -r.y];
	}

	function getPoint(which) {
		return which === "c1"
			? c1
			: which === "c2"
			? c2
			: which === "p"
			? pShown
			: q;
	}

	function setPoint(which, v) {
		if (which === "c1") c1 = v;
		else if (which === "c2") c2 = v;
		else if (which === "p") {
			mode = "in";
			p = v;
		} else {
			// Ask about an output: q stays where it is put, and the input marker
			// goes to the nearest input that lands there (if any).
			mode = "out";
			q = v;
			p = closestOnSolution(preimage(c1, c2, v), p);
		}
	}

	function startDrag(evt, which) {
		cancelAnimation();
		saved = null;
		dragging = which;
		if (which === "p") {
			p = [...pShown];
			mode = "in";
		} else if (which === "q") {
			p = [...pShown];
			mode = "out";
		}
		evt.currentTarget.setPointerCapture?.(evt.pointerId);
		evt.preventDefault();
	}

	function onMove(evt) {
		if (!dragging) return;
		const el = dragging === "p" ? svgIn : svgOut;
		const m = toMath(evt, el);
		if (!m) return;
		setPoint(dragging, [
			tidy(clamp(m[0], -LIMIT, LIMIT)),
			tidy(clamp(m[1], -LIMIT, LIMIT))
		]);
	}

	function endDrag() {
		dragging = "";
	}

	const ARROWS = {
		ArrowLeft: [-1, 0],
		ArrowRight: [1, 0],
		ArrowUp: [0, 1],
		ArrowDown: [0, -1]
	};

	function onKey(evt, which) {
		const delta = ARROWS[evt.key];
		if (!delta) return;
		evt.preventDefault();
		cancelAnimation();
		saved = null;
		const step = snapOn ? STEP : 0.1;
		const cur = getPoint(which);
		setPoint(which, [
			tidy(clamp(cur[0] + delta[0] * step, -LIMIT, LIMIT)),
			tidy(clamp(cur[1] + delta[1] * step, -LIMIT, LIMIT))
		]);
	}

	// ---- Animation -------------------------------------------------------

	function cancelAnimation() {
		if (raf) cancelAnimationFrame(raf);
		raf = 0;
		animating = false;
	}

	// Glide both columns to new positions (or jump, if the person prefers
	// reduced motion).
	function animateTo(t1, t2, ms = 800) {
		cancelAnimation();
		const reduce = window.matchMedia?.(
			"(prefers-reduced-motion: reduce)"
		).matches;
		if (reduce || ms <= 0) {
			c1 = [...t1];
			c2 = [...t2];
			return;
		}
		const f1 = [...c1];
		const f2 = [...c2];
		const t0 = performance.now();
		animating = true;
		const frame = (now) => {
			const t = Math.min(1, (now - t0) / ms);
			const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in-out
			c1 = lerp2(f1, t1, e);
			c2 = lerp2(f2, t2, e);
			if (t < 1) {
				raf = requestAnimationFrame(frame);
			} else {
				c1 = [...t1];
				c2 = [...t2];
				animating = false;
				raf = 0;
			}
		};
		raf = requestAnimationFrame(frame);
	}

	function squash() {
		saved = null;
		animateTo(c1, squashTarget(c1, c2), 1200);
	}

	function usePreset(preset) {
		saved = null;
		animateTo(preset.c1, preset.c2, 600);
	}

	// "Undo it": run the transformation backwards. The output picture glides
	// back to the unit square; the green dot lands back on the input it came
	// from. Only possible when an inverse exists.
	function undo() {
		if (singular) return;
		saved = { c1: [...c1], c2: [...c2] };
		animateTo(IDENTITY.c1, IDENTITY.c2, 1600);
	}

	function redo() {
		if (!saved) return;
		const target = saved;
		saved = null;
		animateTo(target.c1, target.c2, 1600);
	}

	onDestroy(cancelAnimation);
</script>

<section
	id="determinant-lab"
	class="relative bg-base-300 px-6 py-32"
	aria-labelledby="determinant-lab-title"
>
	<div class="mx-auto max-w-6xl">
		<!-- Introduction -->
		<div class="prose prose-xl mx-auto">
			<h2 id="determinant-lab-title">Can you always undo a matrix?</h2>
			<p>
				A matrix moves every point of the plane somewhere else. To <B>undo</B> it
				you have to start from where a point ended up and work out where it came
				from. Below, the plane on the left holds the <B>inputs</B> and the plane
				on the right shows where the matrix sends them, the <B>outputs</B>.
			</p>
			<p>
				The two arrows on the right are the two columns of the matrix: they show
				where the standard basis vectors <Tex expr={"(1,0)"} /> and
				<Tex expr={"(0,1)"} /> land. The <B>unit square</B>, the square those
				two basis vectors span, lands on the parallelogram between them. The
				<B>determinant</B> is the area of that parallelogram, and because the transformation
				is linear, it is also how much the matrix stretches or shrinks area everywhere.
				A negative sign means space was flipped over.
			</p>
			<p>
				So here is the question to keep asking: <B
					>pick an output. How many inputs land on it?</B
				>
			</p>
		</div>

		<!-- Two planes: inputs on the left, outputs on the right -->
		<div class="mt-16 grid items-start gap-10 lg:grid-cols-2">
			<!-- INPUTS -->
			<figure class="m-0">
				<h3 class="mb-3 mt-0 text-xl font-bold">Inputs</h3>
				<svg
					bind:this={svgIn}
					viewBox="{-VIEW} {-VIEW} {2 * VIEW} {2 * VIEW}"
					class="aspect-square w-full touch-none select-none rounded-2xl"
					style="touch-action: none;"
					role="group"
					aria-label="Input plane showing the unit square and the inputs that land on the chosen output"
					on:pointermove={onMove}
					on:pointerup={endDrag}
					on:pointercancel={endDrag}
				>
					<rect
						x={-VIEW}
						y={-VIEW}
						width={2 * VIEW}
						height={2 * VIEW}
						fill={colorB2}
					/>

					<!-- Every input at once, when the whole plane lands on the output -->
					{#if sources.kind === "all"}
						<rect
							x={-VIEW}
							y={-VIEW}
							width={2 * VIEW}
							height={2 * VIEW}
							fill={colorMany}
							fill-opacity="0.25"
						/>
					{/if}

					<g stroke={colorGridAlt} stroke-width="0.03" opacity="0.8">
						{#each range as k}
							{#if k !== 0}
								<line x1={k} y1={-VIEW} x2={k} y2={VIEW} />
								<line x1={-VIEW} y1={-k} x2={VIEW} y2={-k} />
							{/if}
						{/each}
					</g>
					<g stroke={colorGrid} stroke-width="0.05">
						<line x1="0" y1={-VIEW} x2="0" y2={VIEW} />
						<line x1={-VIEW} y1="0" x2={VIEW} y2="0" />
					</g>

					<!-- The unit square and the F, before the transformation -->
					<polygon
						points={inSquarePoints}
						fill="#ffffff"
						fill-opacity="0.08"
						stroke="#ffffff"
						stroke-opacity="0.6"
						stroke-width="0.04"
					/>
					<polygon points={inFPoints} fill="#ffffff" fill-opacity="0.85" />

					<!-- The basis vectors that the columns on the right are the images of -->
					<line
						x1="0"
						y1="0"
						x2="1"
						y2="0"
						stroke={colorX}
						stroke-width="0.09"
						stroke-linecap="round"
					/>
					<line
						x1="0"
						y1="0"
						x2="0"
						y2="-1"
						stroke={colorY}
						stroke-width="0.09"
						stroke-linecap="round"
					/>

					<!-- A whole line of inputs share the chosen output -->
					{#if sources.kind === "line"}
						<line
							x1={sources.p[0] - sources.dir[0] * 20}
							y1={-(sources.p[1] - sources.dir[1] * 20)}
							x2={sources.p[0] + sources.dir[0] * 20}
							y2={-(sources.p[1] + sources.dir[1] * 20)}
							stroke={colorMany}
							stroke-width="0.12"
							stroke-linecap="round"
						/>
					{/if}

					<!-- Nothing lands on the chosen output -->
					{#if sources.kind === "none"}
						<text
							x="0"
							y={-VIEW + 1}
							text-anchor="middle"
							font-size="0.5"
							font-weight="700"
							fill={colorWarn}
							paint-order="stroke"
							stroke={colorB2}
							stroke-width="0.14"
						>
							no input lands on that output
						</text>
					{/if}

					{#if edge}
						<g transform="translate({edge.x} {-edge.y}) rotate({edge.angle})">
							<polygon
								points="0.5,0 -0.25,0.35 -0.25,-0.35"
								fill={colorProbe}
								stroke="#ffffff"
								stroke-width="0.05"
								stroke-linejoin="round"
							/>
						</g>
						<text
							x="0"
							y={VIEW - 0.4}
							text-anchor="middle"
							font-size="0.4"
							font-weight="700"
							fill={colorProbe}
							paint-order="stroke"
							stroke={colorB2}
							stroke-width="0.12">the answer is far away, off this plane</text
						>
					{/if}

					<!-- The input marker (drag to see where it goes) -->
					<g
						role="button"
						tabindex="0"
						class="cursor-grab outline-none"
						aria-label="Input point, currently {coord(
							pShown
						)}. Drag, or use the arrow keys."
						on:pointerdown={(e) => startDrag(e, "p")}
						on:keydown={(e) => onKey(e, "p")}
					>
						<circle
							cx={pShown[0]}
							cy={-pShown[1]}
							r="0.55"
							fill="transparent"
						/>
						<circle
							cx={pShown[0]}
							cy={-pShown[1]}
							r="0.22"
							fill={sources.kind === "none" ? "none" : colorProbe}
							stroke={sources.kind === "none" ? colorWarn : "#ffffff"}
							stroke-dasharray={sources.kind === "none" ? "0.1 0.08" : "none"}
							stroke-width="0.06"
						/>
					</g>
					{#if sources.kind !== "none"}
						<text
							x={labelX(pShown)}
							y={labelY(pShown)}
							text-anchor={labelAnchor(pShown)}
							font-size="0.34"
							font-weight="700"
							fill={colorProbe}
							paint-order="stroke"
							stroke={colorB2}
							stroke-width="0.12"
							stroke-linejoin="round">{coord(pShown)}</text
						>
					{/if}
				</svg>
				<figcaption class="mt-3 text-sm opacity-80">
					Drag the green dot to send an input through the matrix. The white
					square is the unit square.
				</figcaption>
			</figure>

			<!-- OUTPUTS -->
			<figure class="m-0">
				<h3 class="mb-3 mt-0 text-xl font-bold">Outputs</h3>
				<svg
					bind:this={svgOut}
					viewBox="{-VIEW} {-VIEW} {2 * VIEW} {2 * VIEW}"
					class="aspect-square w-full touch-none select-none rounded-2xl"
					style="touch-action: none;"
					role="group"
					aria-label="Output plane showing where the matrix sends the unit square, with the chosen output point"
					on:pointermove={onMove}
					on:pointerup={endDrag}
					on:pointercancel={endDrag}
				>
					<rect
						x={-VIEW}
						y={-VIEW}
						width={2 * VIEW}
						height={2 * VIEW}
						fill={colorB2}
					/>

					<g stroke={colorGridAlt} stroke-width="0.03" opacity="0.8">
						{#each range as k}
							{#if k !== 0}
								<line x1={k} y1={-VIEW} x2={k} y2={VIEW} />
								<line x1={-VIEW} y1={-k} x2={VIEW} y2={-k} />
							{/if}
						{/each}
					</g>
					<g stroke={colorGrid} stroke-width="0.05">
						<line x1="0" y1={-VIEW} x2="0" y2={VIEW} />
						<line x1={-VIEW} y1="0" x2={VIEW} y2="0" />
					</g>

					<!-- The grid after the transformation -->
					<g stroke={colorVector} stroke-width="0.035" opacity="0.5">
						{#each lines as l}
							<line x1={l.p0[0]} y1={-l.p0[1]} x2={l.p1[0]} y2={-l.p1[1]} />
						{/each}
					</g>

					<!-- When flat, the only places that can be reached -->
					{#if imageDir}
						<line
							x1={-imageDir[0] * 20}
							y1={imageDir[1] * 20}
							x2={imageDir[0] * 20}
							y2={-imageDir[1] * 20}
							stroke={colorWarn}
							stroke-width="0.07"
							stroke-dasharray="0.22 0.16"
						/>
					{/if}

					<!-- The unit square after the transformation -->
					<polygon
						points={squarePoints}
						fill={singular ? "none" : accent}
						fill-opacity="0.22"
						stroke={accent}
						stroke-width={singular ? 0.1 : 0.05}
						stroke-linejoin="round"
					/>

					<!-- The F, so flips are visible -->
					<polygon points={fPoints} fill="#ffffff" fill-opacity="0.85" />

					<!-- The two columns -->
					<line
						x1="0"
						y1="0"
						x2={c1[0]}
						y2={-c1[1]}
						stroke={colorX}
						stroke-width="0.09"
						stroke-linecap="round"
					/>
					<line
						x1="0"
						y1="0"
						x2={c2[0]}
						y2={-c2[1]}
						stroke={colorY}
						stroke-width="0.09"
						stroke-linecap="round"
					/>

					<!-- The output marker: drag it to ask "which inputs land here?" -->
					<g
						role="button"
						tabindex="0"
						class="cursor-grab outline-none"
						aria-label="Output point, currently {coord(
							q
						)}. Drag, or use the arrow keys, to ask which inputs land there."
						on:pointerdown={(e) => startDrag(e, "q")}
						on:keydown={(e) => onKey(e, "q")}
					>
						<circle cx={q[0]} cy={-q[1]} r="0.55" fill="transparent" />
						<circle
							cx={q[0]}
							cy={-q[1]}
							r="0.3"
							fill="none"
							stroke={sources.kind === "none" ? colorWarn : colorProbe}
							stroke-width="0.08"
						/>
						{#if sources.kind === "none"}
							<path
								d="M {q[0] - 0.15} {-q[1] - 0.15} L {q[0] + 0.15} {-q[1] +
									0.15} M {q[0] + 0.15} {-q[1] - 0.15} L {q[0] - 0.15} {-q[1] +
									0.15}"
								stroke={colorWarn}
								stroke-width="0.08"
								stroke-linecap="round"
							/>
						{:else}
							<circle cx={q[0]} cy={-q[1]} r="0.12" fill={colorProbe} />
						{/if}
					</g>

					<!-- Handles for the columns: drag these -->
					<g
						role="button"
						tabindex="0"
						class="cursor-grab outline-none"
						aria-label="First column, where (1, 0) lands, currently {coord(
							c1
						)}. Drag, or use the arrow keys."
						on:pointerdown={(e) => startDrag(e, "c1")}
						on:keydown={(e) => onKey(e, "c1")}
					>
						<circle cx={c1[0]} cy={-c1[1]} r="0.5" fill="transparent" />
						<circle
							cx={c1[0]}
							cy={-c1[1]}
							r="0.2"
							fill={colorX}
							stroke="#ffffff"
							stroke-width="0.05"
						/>
					</g>
					<g
						role="button"
						tabindex="0"
						class="cursor-grab outline-none"
						aria-label="Second column, where (0, 1) lands, currently {coord(
							c2
						)}. Drag, or use the arrow keys."
						on:pointerdown={(e) => startDrag(e, "c2")}
						on:keydown={(e) => onKey(e, "c2")}
					>
						<circle cx={c2[0]} cy={-c2[1]} r="0.5" fill="transparent" />
						<circle
							cx={c2[0]}
							cy={-c2[1]}
							r="0.2"
							fill={colorY}
							stroke="#ffffff"
							stroke-width="0.05"
						/>
					</g>

					<!-- Coordinates, right next to the points -->
					<g
						font-size="0.34"
						font-weight="700"
						paint-order="stroke"
						stroke={colorB2}
						stroke-width="0.12"
						stroke-linejoin="round"
					>
						<text
							x={labelX(c1)}
							y={labelY(c1)}
							text-anchor={labelAnchor(c1)}
							fill={colorX}>{coord(c1)}</text
						>
						<text
							x={labelX(c2)}
							y={labelY(c2)}
							text-anchor={labelAnchor(c2)}
							fill={colorY}>{coord(c2)}</text
						>
						<text
							x={labelX(q)}
							y={labelY(q)}
							text-anchor={labelAnchor(q)}
							fill={sources.kind === "none" ? colorWarn : colorProbe}
							>{coord(q)}{sources.kind === "none" ? " unreachable" : ""}</text
						>
					</g>
				</svg>
				<figcaption class="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
					<span
						><span
							class="mr-1 inline-block h-3 w-3 rounded-full align-middle"
							style:background={colorX}
						/> where (1, 0) lands</span
					>
					<span
						><span
							class="mr-1 inline-block h-3 w-3 rounded-full align-middle"
							style:background={colorY}
						/> where (0, 1) lands</span
					>
					<span
						><span
							class="mr-1 inline-block h-3 w-3 rounded-sm align-middle"
							style:background={accent}
						/> the unit square after the transformation</span
					>
					{#if imageDir}
						<span
							><span
								class="mr-1 inline-block h-0 w-4 border-t-2 border-dashed align-middle"
								style:border-color={colorWarn}
							/> all the matrix can reach</span
						>
					{/if}
				</figcaption>
				<p class="mb-0 mt-2 text-sm opacity-80">
					Drag the green ring to pick an output and ask which inputs land on it.
				</p>
			</figure>
		</div>

		<!-- The answer to the question, live -->
		<div
			class="mt-8 rounded-box border-l-8 bg-base-100 p-5 text-lg leading-relaxed"
			style:border-color={verdict.tone}
			aria-live="polite"
		>
			<b style:color={verdict.tone}>{verdict.head}</b>
			{verdict.body}
		</div>

		<div
			class="mt-10 grid items-start gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
		>
			<!-- Readouts -->
			<div class="rounded-box bg-base-100 p-5">
				<div class="flex flex-wrap items-center gap-x-8 gap-y-4">
					<div class="flex items-center gap-3">
						<span class="text-xl font-bold">A =</span>
						<div class="matrix text-xl font-semibold tabular-nums">
							<span style:color={colorX}>{formatNum(c1[0])}</span>
							<span style:color={colorY}>{formatNum(c2[0])}</span>
							<span style:color={colorX}>{formatNum(c1[1])}</span>
							<span style:color={colorY}>{formatNum(c2[1])}</span>
						</div>
					</div>
					<div
						class="badge badge-lg border-0 font-bold text-base-300"
						style:background={accent}
					>
						{status}
					</div>
				</div>

				<div class="mt-5 text-lg tabular-nums">
					<Tex expr={"\\det A = ad - bc"} /> = ({formatNum(c1[0])})({formatNum(
						c2[1]
					)}) &minus; ({formatNum(c2[0])})({formatNum(c1[1])}) =
					<b style:color={accent}>{formatNum(det)}</b>
				</div>

				<div class="mt-5">
					<div class="mb-1 flex justify-between text-sm">
						<span>Area of the unit square after the transformation</span>
						<b class="tabular-nums" style:color={accent}
							>{formatNum(Math.abs(det))}</b
						>
					</div>
					<div class="relative h-3 overflow-hidden rounded-full bg-base-300">
						<div
							class="absolute inset-y-0 left-0 rounded-full"
							style:width="{barPct}%"
							style:background={accent}
						/>
						<div
							class="absolute inset-y-0 w-0.5 bg-white"
							style:left="{(1 / BAR_MAX) * 100}%"
						/>
					</div>
					<div class="mt-1 text-xs opacity-70">
						The white tick marks area 1, the size of the original square. The
						bar is full at {BAR_MAX}.
					</div>
				</div>

				<p class="mb-0 mt-5 text-sm">
					To get back to the unit square, area would have to be rescaled by
					<b class="tabular-nums">{inverseScale}</b>.
				</p>
			</div>

			<!-- Controls -->
			<div class="flex flex-col gap-5">
				<p class="m-0 text-lg leading-relaxed">{story}</p>

				<div class="flex flex-wrap items-center gap-2">
					{#if saved && atIdentity}
						<button
							class="btn btn-sm btn-primary"
							on:click={redo}
							disabled={animating}
						>
							Redo it
						</button>
					{:else}
						<button
							class="btn btn-sm btn-primary"
							on:click={undo}
							disabled={singular || animating || atIdentity}
						>
							Undo it
						</button>
					{/if}
					<button
						class="btn btn-sm"
						on:click={squash}
						disabled={singular || animating}
					>
						Squash toward singular
					</button>
					<button
						class="btn btn-sm btn-ghost"
						on:click={() => usePreset(EXAMPLE)}>Reset</button
					>
					<label class="label ml-auto cursor-pointer gap-2 py-0">
						<span class="label-text">Snap to grid</span>
						<input
							type="checkbox"
							class="toggle toggle-sm"
							bind:checked={snapOn}
						/>
					</label>
				</div>

				{#if singular}
					<p class="m-0 text-sm opacity-80">
						<b>Undo it</b> is switched off: this matrix has no inverse. Playing it
						backwards would mean choosing, for every output, one of many inputs,
						or finding that there are none.
					</p>
				{:else if flipped}
					<p class="m-0 text-sm opacity-80">
						<b>Undo it</b> turns the picture back into the unit square. This matrix
						flips space, so the picture briefly goes flat as the F turns over.
					</p>
				{:else}
					<p class="m-0 text-sm opacity-80">
						<b>Undo it</b> turns the parallelogram back into the unit square, and
						the green dot returns to the input it came from.
					</p>
				{/if}

				<div class="flex flex-wrap items-center gap-2">
					<span class="text-sm opacity-70">Try:</span>
					{#each PRESETS as preset}
						<button
							class="btn btn-sm btn-outline"
							on:click={() => usePreset(preset)}
						>
							{preset.label}
						</button>
					{/each}
				</div>
			</div>
		</div>

		<div class="prose prose-xl mx-auto mt-24">
			<Action>
				<ul class="list-none">
					<li>
						<ActionIcon icon={Grab} /><B>Drag the green dot on the left</B> and watch
						its output follow on the right. Then <B
							>drag the green ring on the right</B
						>
						and see which inputs light up on the left.
					</li>
					<li>
						<ActionIcon icon={Undo2} /><B>Press "Undo it"</B> and watch the parallelogram
						turn back into the unit square.
					</li>
					<li>
						<ActionIcon icon={Play} /><B>Press "Squash toward singular"</B>,
						then press <B>"Collapse"</B> and drag the green ring onto, and then off,
						the red line.
					</li>
					<li>
						<ActionIcon icon={MousePointerClick} /><B
							>Drag the pink and purple dots</B
						>
						to change the matrix itself, and watch the area and the sign of the determinant.
					</li>
				</ul>
			</Action>

			<h3>Why a zero determinant means no inverse</h3>
			<p>
				If the determinant is not zero, the parallelogram has real area, and
				every output point came from exactly one input point. The ring always
				has a single green dot answering it, the transformation can be undone,
				and the inverse rescales area by 1 / determinant so that the
				parallelogram becomes the unit square again.
			</p>
			<p>
				If the determinant is zero, the two columns lie along one line, and the
				square is flattened onto it. Two things go wrong at once. Most of the
				plane can no longer be reached: a ring anywhere off the red line has no
				input at all. And for the outputs that can be reached, a whole line of
				inputs, the yellow line, all land on the same one. Once different inputs
				have been merged, there is no way to know which one you started from, so
				no inverse can exist.
			</p>
			<p>
				Notice what happens just before that. As the matrix gets close to flat,
				the green dot that answers the ring runs away to the far edge of the
				left plane: undoing a nearly flat matrix means stretching space
				enormously.
			</p>
			<p>
				This is not special to two dimensions. In 3D the determinant is the
				volume of the box that the unit cube lands on, and a determinant of 0
				means the cube has been flattened into a plane, a line, or a point. In
				any dimension, a matrix is invertible exactly when its columns still
				point in genuinely different directions, so that the unit square, cube,
				or hypercube keeps a nonzero volume.
			</p>
		</div>
	</div>
</section>

<style>
	.matrix {
		display: grid;
		grid-template-columns: repeat(2, 4.5rem);
		gap: 0.25rem 0.75rem;
		justify-items: end;
		padding: 0.1rem 0.75rem;
		border-left: 2px solid currentColor;
		border-right: 2px solid currentColor;
		border-radius: 0.35rem;
	}
</style>
