module.exports = function(api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { web: { disableImportExportTransform: false } }],
      ['@babel/preset-env', {
        targets: {
          chrome: "47"
        },
        forceAllTransforms: true,
        modules: false
      }]
    ]
  };
};
