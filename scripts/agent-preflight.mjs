#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const allowedArgs = new Set(["--allow-main"]);
const unknownArgs = [...args].filter((arg) => !allowedArgs.has(arg));

if (unknownArgs.length > 0) {
  fail(`unknown option: ${unknownArgs.join(", ")}`, ["usage: pnpm agent:preflight [--allow-main]"]);
}

const allowMain = args.has("--allow-main");

let branch;
let root;
let gitDir;
let gitCommonDir;
let superproject;
let status;

try {
  branch = git(["branch", "--show-current"]);
  root = git(["rev-parse", "--show-toplevel"]);
  gitDir = git(["rev-parse", "--git-dir"]);
  gitCommonDir = git(["rev-parse", "--git-common-dir"]);
  superproject = git(["rev-parse", "--show-superproject-working-tree"], { allowFailure: true });
  status = git(["status", "--porcelain=v1"]);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail("not inside a usable git repository", [message]);
}

if (!branch) {
  fail("detached HEAD is not allowed for implementation work", [
    "Create a named feature branch or worktree before editing.",
  ]);
}

const protectedBranch = branch === "main" || branch === "master";
if (protectedBranch && !allowMain) {
  fail(`current branch is ${branch}`, [
    "Create an isolated feature branch/worktree before implementation.",
    "Use --allow-main only when the user has explicitly approved main-branch implementation.",
  ]);
}

if (status) {
  fail("working tree is not clean", [
    "Commit, stash, or remove unrelated local changes before implementation.",
    status,
  ]);
}

const isolated = gitDir !== gitCommonDir && !superproject;

console.log("agent-preflight ok");
console.log(`branch: ${branch}`);
console.log(`root: ${root}`);
console.log(`git dir: ${gitDir}`);
console.log(`git common dir: ${gitCommonDir}`);
console.log(`workspace: ${isolated ? "linked worktree" : "normal checkout"}`);
console.log("working tree: clean");
if (protectedBranch && allowMain) {
  console.log("main override: enabled");
}

function git(commandArgs, options = {}) {
  try {
    return execFileSync("git", commandArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (options.allowFailure) {
      return "";
    }
    throw error;
  }
}

function fail(message, details = []) {
  console.error(`agent-preflight failed: ${message}`);
  for (const detail of details) {
    if (detail) {
      console.error(detail);
    }
  }
  process.exit(1);
}
