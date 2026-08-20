export const reactCompilerOptions = /** @type {const} */ ({
  compilationMode: "infer",
  eslintSuppressionRules: /** @type {string[]} */ ([]),
  panicThreshold: "all_errors",
  target: "19",
});

export const reactCompilerStrictnessFixture = `
  export function StrictnessFixture({
    render = <button type="button">Strict</button>,
  }) {
    return render;
  }
`;
