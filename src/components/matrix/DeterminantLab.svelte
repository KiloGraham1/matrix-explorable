<script>
	import { onDestroy } from "svelte";
	import { Grab, Play, MousePointerClick } from "lucide-svelte";
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
		kernelDirection,
		formatNum,
		F_GLYPH,
		NEARLY_SINGULAR
	} from "$utils/linalg2d.js";

	// ---- Constants -------------------------------------------------------

	// Starting matrix, given by its columns: where (1, 0) and (0, 1) land.
	// The default is the example matrix from the explainer, [[1, 2], [-2, 0]],
	// whose determinant is 4. "Reset" returns to it.
	export let start1 = [1, -2];
	export let start2 = [2, 0];

	const EXAMPLE = { c1: [...start1], c2: [...start2] };

	const PRESETS = [
		{ label: "Identity", c1: [1, 0], c2: [0, 1] },
		{ label: "Stretch", c1: [2, 0], c2: [0, 1.5] },
		{ label: "Rotate", c1: [0, 1], c2: [-1, 0] },
		{ label: "Shear", c1: [1, 0], c2: [1, 1] },
		{ label: "Mirror", c1: [1, 0], c2: [0, -1] },
		{ label: "Collapse", c1: [1, 2], c2: [2, 4] }
	];

	const VIEW = 5; // the plane shows -VIEW..VIEW on both axes
	const LIMIT = 4.5; // handles stay inside the visible plane
	const STEP = 0.5; // snapping step
	const GRID_N = 12; // transformed grid spans -GRID_N..GRID_N
	const BAR_MAX = 8; // the area bar is full at this area

	const colorWarn = "#ff5555"; // collapsed
	const colorKernel = "#f1fa8c"; // the line of inputs sent to the origin

	const range = Array.from({ length: 2 * VIEW + 1 }, (_, i) => i - VIEW);

	// ---- State -----------------------------------------------------------

	let c1 = [...EXAMPLE.c1]; // where (1, 0) lands: first column
	let c2 = [...EXAMPLE.c2]; // where (0, 1) lands: second column
	let snapOn = true;
	let dragging = 0; // 0 = nothing, 1 = first column, 2 = second column
	let animating = false;
	let svgEl;
	let raf = 0;

	// ---- Derived values --------------------------------------------------

	$: det = det2(c1, c2);
	$: singular = isSingular(det);
	$: nearly = !singular && Math.abs(det) < NEARLY_SINGULAR;
	$: flipped = !singular && det < 0;
	$: rk = rank(c1, c2);
	$: kernel = kernelDirection(c1, c2);

	$: corners = unitSquareImage(c1, c2);
	$: fGlyph = F_GLYPH.map((p) => applyMatrix(c1, c2, p));
	$: lines = gridLines(c1, c2, GRID_N);

	$: accent = singular ? colorWarn : flipped ? colorZ : colorVector;
	$: barPct = Math.min(Math.abs(det) / BAR_MAX, 1) * 100;

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

	$: story = singular
		? rk === 0
			? "Both arrows have length zero, so the entire plane is crushed onto a single point. Every input lands in the same place."
			: "The two arrows lie along one line, so the unit square has been squashed completely flat and its area is 0. The whole plane now lands on that single line. Every input along the dashed line lands on the origin, so many different inputs share one output. Nothing could tell them apart afterwards, which is why a matrix with determinant 0 has no inverse."
		: nearly
		? "The square is almost flat. An inverse still exists, but it would have to stretch space enormously to undo this squashing, so tiny errors get blown up. Computers struggle with matrices like this."
		: flipped
		? "The area of the shaded parallelogram is the size of the determinant, but the sign is negative: the F has been mirrored, so space was flipped over. This is still invertible, because the inverse just flips it back."
		: "The unit square became a parallelogram whose area is the determinant. Each output came from exactly one input, so the transformation can be undone by rescaling area by 1 / determinant.";

	// ---- Drawing helpers (math coordinates -> SVG coordinates) -----------

	// SVG's y axis points down, so flip the sign of y.
	const pt = (p) => `${p[0]},${-p[1]}`;
	$: squarePoints = corners.map(pt).join(" ");
	$: fPoints = fGlyph.map(pt).join(" ");

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

	// Pointer position in plane (math) coordinates.
	function toMath(evt) {
		if (!svgEl) return null;
		const ctm = svgEl.getScreenCTM();
		if (!ctm) return null;
		const p = svgEl.createSVGPoint();
		p.x = evt.clientX;
		p.y = evt.clientY;
		const q = p.matrixTransform(ctm.inverse());
		return [q.x, -q.y];
	}

	function startDrag(evt, which) {
		cancelAnimation();
		dragging = which;
		evt.currentTarget.setPointerCapture?.(evt.pointerId);
		evt.preventDefault();
	}

	function onMove(evt) {
		if (!dragging) return;
		const p = toMath(evt);
		if (!p) return;
		const q = [
			tidy(clamp(p[0], -LIMIT, LIMIT)),
			tidy(clamp(p[1], -LIMIT, LIMIT))
		];
		if (dragging === 1) c1 = q;
		else c2 = q;
	}

	function endDrag() {
		dragging = 0;
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
		const step = snapOn ? STEP : 0.1;
		const cur = which === 1 ? c1 : c2;
		const q = [
			tidy(clamp(cur[0] + delta[0] * step, -LIMIT, LIMIT)),
			tidy(clamp(cur[1] + delta[1] * step, -LIMIT, LIMIT))
		];
		if (which === 1) c1 = q;
		else c2 = q;
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
		animateTo(c1, squashTarget(c1, c2), 1200);
	}

	function usePreset(preset) {
		animateTo(preset.c1, preset.c2, 600);
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
				The two arrows below are the two columns of a matrix: they show where
				the standard basis vectors <Tex expr={"(1,0)"} /> and
				<Tex expr={"(0,1)"} /> land. Together they pin down the whole transformation,
				and the <B>unit square</B>, the square those two basis vectors span, is
				a handy ruler for what the matrix does. It lands on the parallelogram
				between the two arrows.
			</p>
			<p>
				The <B>determinant</B> of the matrix is the area of that parallelogram, and
				because the transformation is linear, it is also how much the matrix stretches
				or shrinks area anywhere in the plane. A negative sign means space was flipped
				over, like a mirror image.
			</p>
		</div>

		<div
			class="mt-16 grid items-start gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
		>
			<!-- The plane -->
			<figure class="m-0">
				<svg
					bind:this={svgEl}
					viewBox="{-VIEW} {-VIEW} {2 * VIEW} {2 * VIEW}"
					class="aspect-square w-full touch-none select-none rounded-2xl"
					style="touch-action: none;"
					role="group"
					aria-label="Interactive plane showing the unit square and where the matrix sends it"
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

					<!-- The original plane: a faint integer grid with brighter axes -->
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

					<!-- The unit square before the transformation -->
					<polygon
						points="0,0 1,0 1,-1 0,-1"
						fill="none"
						stroke="#ffffff"
						stroke-opacity="0.55"
						stroke-width="0.04"
						stroke-dasharray="0.15 0.12"
					/>

					<!-- Inputs that all land on the origin (only when squashed flat) -->
					{#if kernel}
						<line
							x1={-kernel[0] * 8}
							y1={kernel[1] * 8}
							x2={kernel[0] * 8}
							y2={-kernel[1] * 8}
							stroke={colorKernel}
							stroke-width="0.06"
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

					<!-- An F inside the square, so flips are visible -->
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

					<!-- Handles: drag these -->
					<g
						role="button"
						tabindex="0"
						class="cursor-grab outline-none"
						aria-label="First column, where (1, 0) lands, currently {coord(
							c1
						)}. Drag, or use the arrow keys."
						on:pointerdown={(e) => startDrag(e, 1)}
						on:keydown={(e) => onKey(e, 1)}
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
						on:pointerdown={(e) => startDrag(e, 2)}
						on:keydown={(e) => onKey(e, 2)}
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

					<!-- Coordinates, right next to the vectors -->
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
					</g>
				</svg>

				<figcaption class="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
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
					<span
						><span
							class="mr-1 inline-block h-0 w-4 border-t-2 border-dashed align-middle"
							style:border-color="#ffffff"
						/> the unit square before it</span
					>
					{#if kernel}
						<span
							><span
								class="mr-1 inline-block h-0 w-4 border-t-2 border-dashed align-middle"
								style:border-color={colorKernel}
							/> inputs that all land on the origin</span
						>
					{/if}
				</figcaption>
			</figure>

			<!-- Readouts and controls -->
			<div class="flex flex-col gap-6">
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
						<Tex expr={"\\det A = ad - bc"} /> = ({formatNum(
							c1[0]
						)})({formatNum(c2[1])}) &minus; ({formatNum(c2[0])})({formatNum(
							c1[1]
						)}) =
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

				<p class="m-0 text-lg leading-relaxed" aria-live="polite">{story}</p>

				<div class="flex flex-wrap items-center gap-2">
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
						<ActionIcon icon={Grab} /><B>Drag the pink and purple dots</B> to choose
						where the basis vectors land. Watch the area, and the sign, of the determinant.
					</li>
					<li>
						<ActionIcon icon={Play} /><B>Press "Squash toward singular"</B> and watch
						the area fall to 0 as the square flattens into a line.
					</li>
					<li>
						<ActionIcon icon={MousePointerClick} /><B>Try the presets</B>, like
						Shear (the shape changes but the area does not) and Mirror (the F
						flips).
					</li>
				</ul>
			</Action>

			<h3>Why a zero determinant means no inverse</h3>
			<p>
				If the determinant is not zero, the parallelogram has real area, and
				every output point came from exactly one input point. The transformation
				can be undone: the inverse rescales area by 1 / determinant, and the
				parallelogram becomes the unit square again.
			</p>
			<p>
				If the determinant is zero, the two columns lie along one line, and the
				square is flattened onto it. Two things go wrong at once. Most of the
				plane can no longer be reached, and a whole line of inputs, the dashed
				line above, all land on the same output. Once different inputs have been
				merged, there is no way to know which one you started from, so no
				inverse can exist.
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
