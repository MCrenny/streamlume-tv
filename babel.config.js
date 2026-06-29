module.exports = function(api) {
  api.cache(true);
  return {
    presets: [
      ['@babel/preset-env', {
        targets: {
          chrome: "38",
          ie: "11",
          safari: "8"
        },
        forceAllTransforms: true,
        useBuiltIns: 'entry',
        corejs: 3,
        modules: false
      }],
      ['babel-preset-expo', { web: { disableImportExportTransform: false } }]
    ]
  };
};
