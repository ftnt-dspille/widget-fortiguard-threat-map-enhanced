/* Copyright start
  Copyright (C) 2008 - 2026 Fortinet Inc.
  All rights reserved.
  FORTINET CONFIDENTIAL & FORTINET PROPRIETARY SOURCE CODE
  Copyright end */
'use strict';

(function() {
  angular
    .module('cybersponse')
    .factory('threatMapService', threatMapService);

  threatMapService.$inject = ['API', 'toaster', '$resource', 'connectorService'];

  function threatMapService(API, toaster, $resource, connectorService) {
    var service = {
        executeAction: executeAction
    };
    
    function executeAction(connector_name, connector_action, payload) {
      return $resource(API.INTEGRATIONS + 'connectors/?name=' + connector_name)
        .get()
        .$promise
        .then(function (connectorMetaDataForVersion) {
          var connector = connectorMetaDataForVersion && connectorMetaDataForVersion.data && connectorMetaDataForVersion.data[0];
          if (!connector) {
            throw notify('The ' + connector_name + ' connector is not installed on this system. Install it from Content Hub, then reload the page.');
          }
          var defaultConfig = (connector.configuration || []).filter(function (item) { return item.default; });
          if (!defaultConfig.length) {
            throw notify('The ' + connector_name + ' connector has no default configuration. Configure it and mark one configuration as default.');
          }
          return connectorService.executeConnectorAction(connector_name, connector.version, connector_action, defaultConfig[0].config_id, payload);
        })
        .catch(function (error) {
          console.error('Error:', error);
          if (!(error && error.notified)) {
            var reason = error && (error.message || (error.data && (error.data.message || error.data.error)));
            toaster.error({ body: 'The ' + connector_name + ' request failed' + (reason ? ': ' + reason : '.') });
          }
          throw error; // Rethrow the error to be handled by the caller
        });
    }

    function notify(message) {
      toaster.error({ body: message });
      var err = new Error(message);
      err.notified = true;
      return err;
    }

    return service;
  }
})();
