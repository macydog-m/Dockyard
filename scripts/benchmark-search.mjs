import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, cpus, totalmem, release } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';

const mib = bytes => Math.round(bytes / 1024 / 1024 * 100) / 100;
const round = value => Math.round(value * 100) / 100;
const responseBytes = result => Buffer.byteLength(JSON.stringify({
  content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result,
}), 'utf8');

async function measure(dataDir) {
  const importStart = performance.now();
  const { ResourceRegistry } = await import('../packages/core/dist/index.js');
  const importMs = performance.now() - importStart;
  global.gc?.();
  const baseline = process.memoryUsage();
  const registry = new ResourceRegistry(dataDir);
  const start = performance.now();
  const cold = await registry.search('soft smoke');
  const coldQueryMs = performance.now() - start;
  assert.equal(cold.total, 15000);
  const afterCold = process.memoryUsage();
  const queries = ['soft smoke', 'blue flare', '002511', 'png', '能量', 'unknownzzzz', 'fx::Smoke/002511_soft-smoke.png', 'smoke png'];
  for (const query of queries) await registry.search(query);
  const samples = [];
  let maxResponseBytes = 0;
  let peakRss = afterCold.rss;
  for (let i = 0; i < 160; i++) {
    const started = performance.now();
    const result = await registry.search(queries[i % queries.length]);
    samples.push(performance.now() - started);
    assert.ok(result.items.length <= 10);
    const bytes = responseBytes(result);
    assert.ok(bytes <= 60 * 1024);
    maxResponseBytes = Math.max(maxResponseBytes, bytes);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.ceil(samples.length * .95) - 1];
  return {
    records: 30000, samples: samples.length, queryVariants: queries.length,
    moduleImportMs: round(importMs), coldQueryMs: round(coldQueryMs),
    warmMs: { min: round(samples[0]), p50: round(samples[Math.ceil(samples.length * .5) - 1]), p95: round(p95), max: round(samples.at(-1)) },
    targetP95Ms: 200, meetsTarget: p95 <= 200, maxMcpResponseBytes: maxResponseBytes,
    memoryMiB: { baselineRss: mib(baseline.rss), afterColdRss: mib(afterCold.rss), afterColdHeap: mib(afterCold.heapUsed), sampledPeakRss: mib(peakRss) },
  };
}
async function main() {
  const { DockyardManager } = await import('../packages/core/dist/index.js');
  const { folderIndexSchema } = await import('../packages/shared/dist/index.js');
  const root = await mkdtemp(path.join(tmpdir(), 'dockyard-benchmark-'));
  try {
    const dataDir = path.join(root, 'data');
    const source = path.join(root, 'synthetic-source');
    await mkdir(source);
    const manager = new DockyardManager(dataDir);
    await manager.initialize();
    await manager.saveComponent({ schemaVersion: 1, id: 'fx', type: 'folder', name: 'Benchmark FX', source: { path: source } });
    const index = (await manager.store.read('index/fx.json', folderIndexSchema)).value;
    const labels = ['blue-flare', 'soft-smoke', '能量-glow', 'soft-smoke'];
    index.snapshot.entries = Array.from({ length: 30000 }, (_, i) => {
      const key = String(i).padStart(6, '0');
      const name = key + '_' + labels[i % labels.length] + '.png';
      return { relativePath: (i % 2 ? 'Smoke/' : 'Effects/') + name, key, name, extension: '.png' };
    });
    index.lastRefresh.files = 30000;
    await manager.store.write('index/fx.json', folderIndexSchema, index);
    await manager.setWorkspaceComponents('default', ['fx']);
    const execute = promisify(execFile);
    const { stdout } = await execute(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--measure', dataDir], { windowsHide: true, maxBuffer: 1024 * 1024 });
    const benchmark = JSON.parse(stdout);

    // Independently verify actual filesystem enumeration, not synthetic index throughput.
    const realSource = path.join(root, 'real-files');
    await mkdir(realSource);
    for (let directory = 0; directory < 20; directory++) {
      const target = path.join(realSource, 'group-' + directory);
      await mkdir(target);
      await Promise.all(Array.from({ length: 30 }, (_, i) => writeFile(path.join(target, String(directory * 30 + i).padStart(6, '0') + '_烟雾.txt'), 'benchmark content is not indexed', 'utf8')));
    }
    const started = performance.now();
    await manager.saveComponent({ schemaVersion: 1, id: 'real', type: 'folder', name: 'Real tree', source: { path: realSource } });
    const scanMs = performance.now() - started;
    const actual = (await manager.store.read('index/real.json', folderIndexSchema)).value;
    assert.equal(actual.snapshot.entries.length, 600);
    assert.equal(actual.lastRefresh.status, 'ready');
    const report = {
      measuredAt: new Date().toISOString(),
      environment: { platform: process.platform, release: release(), architecture: process.arch, node: process.version, cpu: cpus()[0].model, logicalCpus: cpus().length, totalMemoryMiB: mib(totalmem()) },
      benchmark,
      actualScan: { files: 600, directories: 21, addAndScanMs: round(scanMs), status: actual.lastRefresh.status },
      notes: [
        '30,000 synthetic index records; fresh child process; timings include config reads, index identity checks, ranking and response bounds.',
        'Cold query includes JSON parse/validation and in-memory projection. OS disk cache was not flushed.',
        'Warm samples are sequential across eight queries, after one pass of warm-up. Memory peak is sampled, not an OS maximum.',
        'The separate 600-file tree measures actual Folder add/scan. It is not a 30,000-file scan benchmark.',
      ],
    };
    const output = path.resolve('.local', 'phase2-benchmark.json');
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(report, null, 2));
    if (!benchmark.meetsTarget) process.exitCode = 1;
  } finally {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
    assert.match(relative, /^dockyard-benchmark-[^/\\]+$/);
    await rm(root, { recursive: true, force: true });
  }
}
if (process.argv[2] === '--measure' && process.argv[3]) console.log(JSON.stringify(await measure(process.argv[3])));
else await main();
