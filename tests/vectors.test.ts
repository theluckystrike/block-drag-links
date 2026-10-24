import { describe, expect, it } from 'vitest';
import vectors from './vectors/block-drag-links.json';
import { applyInsertion, blocksInRange, buildLink, classifyLines, collectIds, findBlock, headingSubpath, idInsertion, newBlockId, readableBlockId, reuseId } from '../src/blocks';

/** A random source that returns the numbers of seq in a loop. */
function seqRand(seq: number[]): () => number {
	let i = 0;
	return () => seq[i++ % seq.length] ?? 0;
}

const fns: Record<string, (...args: never[]) => unknown> = {
	findBlock,
	idInsertion,
	applyInsertion,
	headingSubpath,
	buildLink,
	readableBlockId,
	blocksInRange,
	collectIds,
	reuseId,
	newBlockId: ((taken: string[], seq: number[]) => newBlockId(taken, seqRand(seq))) as never,
};

describe('golden vectors (packages/spec/vectors/block-drag-links.json)', () => {
	it('covers acceptance cases A1 to A9', () => {
		for (const n of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) expect(vectors.cases.some((c) => c.name.startsWith(`${n} `))).toBe(true);
		expect(vectors.cases.length).toBeGreaterThanOrEqual(120);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const fn = fns[c.fn];
			expect(fn).toBeTypeOf('function');
			expect(fn!(...(c.args as never[])) ?? null).toEqual(c.expected);
		});
	}
});

describe('cost on a large note (R3 P16)', () => {
	it('finds all blocks of a 50,000 line selection in less than 3 s', () => {
		const big = Array.from({ length: 50_000 }, (_, i) => (i % 2 ? '' : `Paragraph ${i} with words.`));
		const t0 = performance.now();
		const all = blocksInRange(big, 0, big.length - 1, classifyLines(big));
		const ms = performance.now() - t0;
		expect(all.length).toBe(25_000);
		// ESTIMATE: about 0.4 s on the agent Mac. Before the fix it took 23 s.
		expect(ms).toBeLessThan(3000);
	});
});

describe('no stack overflow (R3 round 2 Q24)', () => {
	it('finds the heading over 20,000 -- lines without recursion', () => {
		const deep = ['Text', ...Array.from({ length: 20_000 }, () => '--')];
		expect(findBlock(deep, deep.length - 1)).toEqual({ kind: 'heading', start: 0, end: 0, id: null, heading: 'Text' });
	});
});
