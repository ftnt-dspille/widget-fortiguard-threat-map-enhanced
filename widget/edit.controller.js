/* Copyright start
  Copyright (C) 2008 - 2026 Fortinet Inc.
  All rights reserved.
  FORTINET CONFIDENTIAL & FORTINET PROPRIETARY SOURCE CODE
  Copyright end */
'use strict';
(function () {
    angular
        .module('cybersponse')
        .controller('editFortiGuardThreatMap102DevCtrl', editFortiGuardThreatMap102DevCtrl);

    editFortiGuardThreatMap102DevCtrl.$inject = ['$scope', '$uibModalInstance', 'config'];

    function editFortiGuardThreatMap102DevCtrl($scope, $uibModalInstance, config) {
        $scope.cancel = cancel;
        $scope.save = save;
        $scope.config = config;
        // The edit dialog gates its form on this flag (the platform does not
        // set it); without it the dialog shows the not-configurable message.
        $scope.isConfigurable = true;

        function init() {
        }

        init();

        function cancel() {
            $uibModalInstance.dismiss('cancel');
        }

        function save() {
            $uibModalInstance.close($scope.config);
        }

    }
})();
