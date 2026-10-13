# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""Read {"src": …, "names": [...]} on stdin; print the spans of the definitions those names reach.

`spans` are definitions the names DECLARE. `refSpans` are definitions whose body MENTIONS a name that
declares nothing — localisation from the row's own words, with the mention count so the caller can
refuse a diffuse name. Line numbers are 1-based inclusive and cover decorators through the body.
Nothing here reads a fix commit.
"""
import ast
import json
import re
import sys

DEFS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)


def collect(node, prefix, out):
    for child in ast.iter_child_nodes(node):
        if isinstance(child, DEFS):
            qual = (prefix + "." + child.name) if prefix else child.name
            start = child.lineno
            for d in getattr(child, "decorator_list", []) or []:
                start = min(start, d.lineno)
            out.append({
                "qual": qual,
                "name": child.name,
                "kind": type(child).__name__,
                "start": start,
                "end": child.end_lineno,
                "depth": len(qual.split(".")),
            })
            collect(child, qual, out)
        else:
            collect(child, prefix, out)


def header_end(tree):
    end = 0
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.Assign, ast.AnnAssign, ast.Expr)):
            end = max(end, node.end_lineno or 0)
        else:
            break
    return end


def main():
    req = json.load(sys.stdin)
    src = req["src"]
    names = list(dict.fromkeys(req["names"]))
    try:
        tree = ast.parse(src)
    except SyntaxError as exc:
        print(json.dumps({"ok": False, "reason": "unparseable-source: " + str(exc)[:120]}))
        return
    allsp = []
    collect(tree, "", allsp)
    if req.get("all"):
        print(json.dumps({"ok": True, "spans": allsp, "refSpans": [], "headerEnd": header_end(tree)}))
        return

    declared = []
    hit_names = set()
    for sp in allsp:
        if sp["name"] in names or sp["qual"] in names:
            declared.append(sp)
            hit_names.add(sp["name"])
            hit_names.add(sp["qual"])

    lines = src.split("\n")
    refs = []
    for nm in names:
        if nm in hit_names or "." in nm or len(nm) < 4:
            continue
        pat = re.compile(r"\b" + re.escape(nm) + r"\b")
        reached = {}
        for i, line in enumerate(lines, start=1):
            if not pat.search(line):
                continue
            inner = None
            for sp in allsp:
                if sp["start"] <= i <= sp["end"] and (inner is None or sp["depth"] > inner["depth"]):
                    inner = sp
            if inner is not None:
                reached.setdefault(inner["qual"], inner)
        if reached:
            refs.append({"name": nm, "defs": list(reached.values())})

    print(json.dumps({"ok": True, "spans": declared, "refSpans": refs, "headerEnd": header_end(tree)}))


main()
