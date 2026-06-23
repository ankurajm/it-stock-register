document.addEventListener('DOMContentLoaded', function () {
    var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (el) { return new bootstrap.Tooltip(el); });

    var toastElList = [].slice.call(document.querySelectorAll('.toast'));
    toastElList.map(function (el) { return new bootstrap.Toast(el); });
});
