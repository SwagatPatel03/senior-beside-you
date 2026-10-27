import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { addWords, bridgesFor, DEFAULT_LEVEL, effectiveLevel, knownWords, levelOf, loadLevels, PROFILES, profile, profileBrief, setLevel } from '../plugin/core/levels.mjs';
import { addTechnology, detectStack, levelsText, loadStack, refreshStack, techForPath } from '../plugin/core/stack.mjs';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugin', 'cli', 'senior.mjs');

// A space in the folder name, as in many Windows home folders, catches quoting bugs.
function temp(prefix = 'senior levels ') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function levelsFile() {
  return path.join(temp(), 'levels.json');
}

function write(root, rel, text = '') {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** The seat reservation project the levels were designed on: Spring Boot, Maven, PostgreSQL and Docker. */
function seatProject() {
  const root = temp('senior seats ');
  fs.mkdirSync(path.join(root, '.senior'), { recursive: true });
  write(root, 'pom.xml', '<project><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency><dependency><groupId>org.postgresql</groupId></dependency></dependencies></project>');
  write(root, 'src/main/java/com/example/seats/SeatService.java', 'package com.example.seats;\n');
  write(root, 'src/main/resources/application.properties', 'spring.datasource.url=jdbc:postgresql://localhost/seats\n');
  write(root, 'src/main/resources/db/migration/V1__seats.sql', 'create table seats (id bigint);\n');
  write(root, 'docker-compose.yml', 'services:\n  db:\n    image: postgres:16\n');
  write(root, 'node_modules/left-pad/index.js', '');
  return root;
}

test('every level from 0 to 10 says everything each host needs', () => {
  assert.equal(PROFILES.length, 11);
  PROFILES.forEach((p, i) => {
    assert.equal(p.level, i);
    assert.ok(typeof p.name === 'string' && p.name.length > 3, `level ${i} needs a name`);
    for (const key of ['anchor', 'change', 'design', 'checks', 'failure']) assert.ok(typeof p[key] === 'string' && p[key].length > 20, `level ${i} needs ${key}`);
    assert.ok(['full', 'shape', 'first', 'none'].includes(p.trace), `level ${i} trace`);
    assert.ok(Array.isArray(p.guide) && p.guide.length, `level ${i} guide`);
    assert.ok(typeof p.typeShare === 'number');
  });
  // The share of code the user types never rises with the level, and level 7 is Senior as it was.
  for (let i = 1; i < 11; i++) assert.ok(PROFILES[i].typeShare <= PROFILES[i - 1].typeShare);
  assert.equal(DEFAULT_LEVEL, 7);
  // Levels below 7 never offer to fill in the user's piece: typing it is how they learn.
  for (let i = 0; i < 7; i++) assert.equal(PROFILES[i].fillIn, false);
  assert.equal(profile(42).level, 10);
  assert.equal(profile(-3).level, 0);
});

test('levels follow the person and remember their history', () => {
  const file = levelsFile();
  assert.equal(levelOf('java', loadLevels(file)), null);
  assert.equal(effectiveLevel('java', loadLevels(file)), DEFAULT_LEVEL);
  assert.equal(setLevel('Java', 0, { name: 'Java', file, now: new Date('2026-10-27T10:00:00Z') }), null);
  assert.equal(setLevel('java', 2, { file, now: new Date('2026-10-28T10:00:00Z') }), 0);
  const data = loadLevels(file);
  assert.equal(levelOf('JAVA', data), 2);
  assert.deepEqual(data.levels.java.history.map((h) => h.level), [0, 2]);
  assert.equal(data.levels.java.name, 'Java');
  assert.throws(() => setLevel('java', 11, { file }), /0 to 10/);
  assert.throws(() => setLevel('java', 2.5, { file }), /0 to 10/);
});

test('a word is explained once, then remembered', () => {
  const file = levelsFile();
  assert.deepEqual(addWords('java', ['if', 'class', 'if'], { file }), ['if', 'class']);
  assert.deepEqual(addWords('java', ['class', 'throw'], { file }), ['throw']);
  assert.deepEqual(knownWords('java', loadLevels(file)), ['if', 'class', 'throw']);
});

test('the stack is found from the project files, and dependency folders are ignored', () => {
  const root = seatProject();
  const ids = detectStack(root).map((t) => t.id);
  for (const id of ['java', 'spring-boot', 'maven', 'postgresql', 'docker']) assert.ok(ids.includes(id), `found ${id}`);
  assert.ok(!ids.includes('javascript'), 'node_modules does not count');
  assert.ok(!ids.includes('sql'), 'PostgreSQL claims the .sql files');
  const spring = detectStack(root).find((t) => t.id === 'spring-boot');
  assert.equal(spring.within, 'java');
  assert.deepEqual(detectStack(root).find((t) => t.id === 'docker').found, ['docker-compose.yml']);
});

test('the stack is saved, and technologies added by hand survive a refresh', () => {
  const root = seatProject();
  const first = refreshStack(root);
  assert.ok(first.added.includes('java'));
  addTechnology(root, 'Kafka', ['src/**/events/*.java']);
  const again = refreshStack(root);
  assert.deepEqual(again.added, []);
  assert.ok(loadStack(root).technologies.some((t) => t.id === 'kafka' && t.added));
  // Stored paths are project-relative with forward slashes.
  const raw = fs.readFileSync(path.join(root, '.senior', 'stack.json'), 'utf8');
  assert.ok(!raw.includes('\\\\'), 'no backslashes');
  assert.ok(raw.includes('src/main/java/com/example/seats/SeatService.java'));
});

test('a file takes the lower level of the technologies it belongs to', () => {
  const root = seatProject();
  const stack = detectStack(root) && refreshStack(root).stack;
  const file = levelsFile();
  setLevel('java', 4, { file });
  setLevel('spring-boot', 1, { file });
  setLevel('postgresql', 2, { file });
  setLevel('docker', 6, { file });
  const data = loadLevels(file);
  assert.deepEqual(techForPath(stack, 'src/main/java/com/example/seats/SeatService.java', data), { id: 'spring-boot', name: 'Spring Boot', level: 1, rated: true });
  assert.equal(techForPath(stack, 'src\\main\\resources\\db\\migration\\V1__seats.sql', data).id, 'postgresql');
  assert.equal(techForPath(stack, 'docker-compose.yml', data).level, 6);
  assert.equal(techForPath(stack, 'README.md', data), null);
  // An unrated technology works at the default level.
  const unrated = techForPath(stack, 'pom.xml', data);
  assert.equal(unrated.id, 'maven');
  assert.equal(unrated.level, DEFAULT_LEVEL);
  assert.equal(unrated.rated, false);
});

test('the profile text tells Claude how to guide at the user\'s level', () => {
  const file = levelsFile();
  setLevel('java', 0, { name: 'Java', file });
  setLevel('python', 6, { name: 'Python', file });
  addWords('java', ['class', 'public'], { file });
  const data = loadLevels(file);
  const brief = profileBrief({ id: 'java', name: 'Java', level: 0, rated: true }, data);
  assert.match(brief, /level 0 of 10 \(Never written it\)/);
  assert.match(brief, /one line/i);
  assert.match(brief, /class, public/);
  assert.match(brief, /Python \(6\)/);
  assert.match(brief, /senior words add java/);
  assert.deepEqual(bridgesFor('java', 0, data).map((b) => b.id), ['python']);
  // At level 7 there is nothing about words or comparisons.
  const seven = profileBrief({ id: 'java', name: 'Java', level: 7, rated: false }, data);
  assert.match(seven, /not rated/);
  assert.doesNotMatch(seven, /words add/);
});

test('the session start lists the levels for the project\'s stack', () => {
  const root = seatProject();
  const file = levelsFile();
  const none = levelsText(root, loadLevels(file));
  assert.match(none, /has not rated/);
  assert.match(none, /\/senior:level/);
  setLevel('java', 0, { name: 'Java', file });
  const some = levelsText(root, loadLevels(file));
  assert.match(some, /Java 0/);
  assert.match(some, /Not rated: .*Docker/);
  assert.match(some, /level profile/);
});

test('the CLI sets, lists and explains levels', () => {
  const root = seatProject();
  const env = { ...process.env, SENIOR_LEVELS_FILE: levelsFile() };
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8' });
  assert.match(run('stack', 'detect'), /Spring Boot \(spring-boot\)/);
  assert.match(run('level', 'set', 'java', '0'), /Java is now 0 · Never written it/);
  assert.match(run('level', 'set', 'java', '2'), /It was 0\./);
  assert.match(run('level', 'set', 'codebase', '3'), /This codebase is now 3/);
  const list = run('level', 'list');
  assert.match(list, /Java \(java\): 2 · Can read it with help/);
  assert.match(list, /Docker \(docker\): not rated/);
  assert.match(list, /This codebase: 3/);
  // Java is 2 and Spring Boot is not rated, so a Java file is guided at Java's level.
  const fromPath = JSON.parse(run('level', 'profile', 'src/main/java/com/example/seats/SeatService.java', '--json'));
  assert.equal(fromPath.id, 'java');
  assert.equal(fromPath.level, 2);
  assert.equal(fromPath.profile.trace, 'full');
  assert.match(run('level', 'profile', 'java'), /level 2 of 10/);
  assert.match(run('words', 'add', 'java', 'if', 'throw'), /2 new words/);
  assert.match(run('words', 'list', 'java'), /if, throw/);
  assert.equal(run('level', 'scale').trim().split('\n').length, 11);
});
