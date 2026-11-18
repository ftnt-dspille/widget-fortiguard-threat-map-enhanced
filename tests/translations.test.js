"use strict";
// A widget that renders before its locale file arrives must still end up with real text.
// `{{ ::'ns.KEY' | translate }}` is a one-time binding: it freezes the raw key if the
// translation partial loads after first render, and the analyst sees `ns.KEY` on screen.
// Every translate expression must be a normal (re-evaluating) binding, and the controller
// must not translate synchronously (instantTranslate returns the raw key before load).
//
//   make test-unit WIDGET=<this widget>

const fs = require("fs");
const path = require("path");

const WIDGET = path.join(__dirname, "..", "widget");
const read = (f) => fs.readFileSync(path.join(WIDGET, f), "utf8");

describe("translations survive a late-loading locale file", () => {
  test.each(["view.html", "edit.html"])("%s has no one-time translate bindings", (file) => {
    const html = read(file);
    const frozen = html.match(/\{\{\s*::[^}]*\|\s*translate/g) || [];
    expect(frozen).toEqual([]);
    // and it does use the filter at all, so the test is not vacuous
    expect(html).toMatch(/\|\s*translate/);
  });

  test("the view controller does not translate synchronously", () => {
    expect(read("view.controller.js")).not.toMatch(/instantTranslate\(/);
  });
});
