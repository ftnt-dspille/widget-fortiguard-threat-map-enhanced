"use strict";
// Failure handling for the Global Map: a missing connector, a connector with no
// default configuration and a failed request must each reach the analyst (a toast
// from the service, an alert in the widget from the controller), never only the
// console.
//
//   make test-unit WIDGET=fortiGuardThreatMap

global.jasmine = global.jasmine || {};
require("angular");
require("angular-mocks");

angular.module("cybersponse", []); // eslint-disable-line no-undef
require("../widget/widgetAssets/js/threatMap.service.js");
require("../widget/view.controller.js");

const ngModule = window.angular.mock.module; // eslint-disable-line no-undef
const ngInject = window.angular.mock.inject; // eslint-disable-line no-undef

let connectors; // what the connector lookup returns, or a rejection
let toasts;
let runAction;
let quiet;

function setup(extra) {
  ngModule("cybersponse", ($provide) => {
    toasts = [];
    runAction = jest.fn();
    $provide.value("API", { INTEGRATIONS: "/api/integration/" });
    $provide.value("toaster", { error: (t) => toasts.push(t.body) });
    $provide.value("connectorService", { executeConnectorAction: (...a) => runAction(...a) });
    $provide.value("widgetBasePath", "/w/");
    $provide.value("config", {});
    $provide.value("$resource", () => ({ get: () => ({ $promise: connectors() }) }));
    if (extra) extra($provide);
  });
}

beforeEach(() => {
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  // jsdom never loads <script src>; fire onload so the controller proceeds.
  jest.spyOn(document.head, "appendChild").mockImplementation((el) => {
    if (el.onload) Promise.resolve().then(() => el.onload());
    return el;
  });
  window._ = window._ || { union: (a, b) => Array.from(new Set(a.concat(b))) };
  window.$rootScope = null;
});
afterEach(() => jest.restoreAllMocks());

describe("threatMapService.executeAction", () => {
  const call = (cb) => ngInject(["threatMapService", "$rootScope", (svc, $rs) => {
    let err = null;
    svc.executeAction("fortinet-fortiguard-outbreak", "x", {}).catch((e) => { err = e; });
    $rs.$digest();
    cb(err);
  }]);

  test("connector not installed -> readable error and a toast, no TypeError", () => {
    setup();
    ngInject(["$q", ($q) => { connectors = () => $q.resolve({ data: [] }); }]);
    call((err) => {
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(TypeError);
      expect(err.message).toMatch(/not installed/);
      expect(toasts).toHaveLength(1);
      expect(runAction).not.toHaveBeenCalled();
    });
  });

  test("connector with no default configuration -> readable error and a toast", () => {
    setup();
    ngInject(["$q", ($q) => {
      connectors = () => $q.resolve({ data: [{ version: "3.1.0", configuration: [{ config_id: "c1", default: false }] }] });
    }]);
    call((err) => {
      expect(err).not.toBeInstanceOf(TypeError);
      expect(err.message).toMatch(/no default configuration/);
      expect(toasts).toHaveLength(1);
    });
  });

  test("default configuration present -> runs the action with its id", () => {
    setup();
    ngInject(["$q", ($q) => {
      connectors = () => $q.resolve({ data: [{ version: "3.1.0", configuration: [{ config_id: "c9", default: true }] }] });
      runAction.mockReturnValue($q.resolve({ data: 1 }));
    }]);
    call((err) => {
      expect(err).toBeNull();
      expect(runAction).toHaveBeenCalledWith("fortinet-fortiguard-outbreak", "3.1.0", "x", "c9", {});
      expect(toasts).toHaveLength(0);
    });
  });

  test("request failure -> toasted once with the platform's reason", () => {
    setup();
    ngInject(["$q", ($q) => { connectors = () => $q.reject({ data: { message: "timeout" } }); }]);
    call((err) => {
      expect(err).toBeTruthy();
      expect(toasts).toHaveLength(1);
      expect(toasts[0]).toMatch(/request failed: timeout/);
    });
  });
});

describe("view controller load failure", () => {
  function boot(svc) {
    setup(($provide) => {
      $provide.value("threatMapService", svc);
      $provide.value("$rootScope", Object.assign(window.angular.injector(["ng"]).get("$rootScope"), { theme: { id: "dark" } }));
    });
    let scope;
    ngInject(["$controller", "$rootScope", ($controller, $rs) => {
      scope = $rs.$new();
      $controller("fortiGuardThreatMap102DevCtrl", { $scope: scope });
    }]);
    return scope;
  }
  // $q chains only advance on a digest, and the script-load promise is native, so
  // alternate real ticks with digests until the chain settles.
  const flush = async (scope) => {
    for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 0)); scope.$root.$digest(); }
  };

  test("initial list failing puts the message in the widget and stops the spinner", async () => {
    const scope = boot({ executeAction: () => Promise.reject(new Error("The fortinet-fortiguard-outbreak connector is not installed on this system.")) });
    await flush(scope);
    expect(scope.loadError).toMatch(/not installed/);
    expect(scope.showProcessing).toBeFalsy();
    expect(quiet).toHaveBeenCalled();
  });

  test("a failing map-data call is surfaced, not left spinning", async () => {
    let n = 0;
    const scope = boot({
      executeAction: () => (++n === 1
        ? Promise.resolve({ data: { results: [{ ID: "o1", Name: "x" }] } })
        : Promise.reject(new Error("The connector has no default configuration."))),
    });
    await flush(scope);
    expect(scope.loadError).toMatch(/no default configuration/);
    expect(scope.showProcessing).toBe(false);
  });
});
