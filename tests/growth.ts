// Timing guards that hold on a slow shared CI runner (s1101 FIX item 4). A wall-clock limit such as "less than 300 ms"
// failed on GitHub runners that were 12 to 20 times slower than the agent Mac. These guards divide two times that the
// same test measures on the same machine, so a slow runner slows both times and the ratio stays.

/** Fastest time of `rounds` rounds, in ms. A round repeats fn until it took at least minMs, so a sub-ms timer step does not count. */
export function timeOf(fn: () => unknown, rounds: number, minMs = 0): number {
	let best = Infinity;
	for (let r = 0; r < rounds; r++) {
		let reps = 0;
		let took = 0;
		const t0 = performance.now();
		do {
			fn();
			reps++;
			took = performance.now() - t0;
		} while (took < minMs);
		best = Math.min(best, took / reps);
	}
	return best;
}

/**
 * 10 times the input gives about 10 times the time for linear work and about 100 times for quadratic work.
 * 40 is 4 times the linear value and 2.5 times below the quadratic value. On the agent Mac (2026-11-01) linear work gave 8 to 20.
 */
export const GROWTH_LIMIT = 40;

/**
 * Time at full size n divided by time at size n / 10, both measured in this test. make(n) builds the input outside the
 * timing and returns the work. Each round times the small size and then the full size, back to back, and the guard takes
 * the lowest ratio of 3 rounds: a load burst on a shared machine must hit every round to fail the guard, but a quadratic
 * regression gives about 100 in every round. A first small run warms up the JIT.
 */
export function growth(make: (n: number) => () => unknown, n: number): { ratio: number; text: string } {
	const tenth = Math.round(n / 10);
	const small = make(tenth);
	const big = make(n);
	timeOf(small, 1, 20);
	let best = { ratio: Infinity, text: '' };
	for (let round = 0; round < 3; round++) {
		const s = timeOf(small, 1, 20);
		const b = timeOf(big, 1);
		if (b / s < best.ratio) best = { ratio: b / s, text: `${b.toFixed(1)} ms at size ${n}, ${s.toFixed(2)} ms at size ${tenth}` };
	}
	return best;
}
