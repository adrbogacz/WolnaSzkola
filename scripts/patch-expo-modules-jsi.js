const fs = require('fs');
const path = require('path');

const jsiRoot = path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi');

function patchFile(relativePath, transform) {
  const target = path.join(jsiRoot, ...relativePath.split('/'));
  if (!fs.existsSync(target)) return;
  const source = fs.readFileSync(target, 'utf8');
  const patched = transform(source);
  if (patched !== source) {
    fs.writeFileSync(target, patched);
    console.log(`patched ${relativePath}`);
  }
}

patchFile('apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h', (source) =>
  source.replaceAll('SWIFT_RETURNS_RETAINED RuntimeScheduler', 'RuntimeScheduler'),
);

// Xcode 26.2 / Swift 6.2 still errors on `nonisolated(unsafe)` pointer captures
// into JavaScriptActor.assumeIsolated ("sending … risks causing data races").
// Boxing in @unchecked Sendable is sound: assumeIsolated runs synchronously and
// the pointers never outlive the C callback.
patchFile('apple/Sources/ExpoModulesJSI/Runtime/JavaScriptRuntime.swift', (source) => {
  if (source.includes('Xcode26UncheckedSendable')) return source;

  let next = source.replace(
    '      nonisolated(unsafe) let resultPtr = resultPtr\n\n      return withGuaranteedContext(context) { (context: HostObjectContext, runtime) in\n        return JavaScriptActor.assumeIsolated {\n          return forwardingSwiftErrorsToJS(runtime: runtime) {\n            try context.get(propertyName).writeJSIValue(to: resultPtr)',
    '      let resultPtr = Xcode26UncheckedSendable(value: resultPtr)\n\n      return withGuaranteedContext(context) { (context: HostObjectContext, runtime) in\n        return JavaScriptActor.assumeIsolated {\n          return forwardingSwiftErrorsToJS(runtime: runtime) {\n            try context.get(propertyName).writeJSIValue(to: resultPtr.value)',
  );

  next = next.replace(
    `    nonisolated(unsafe) let thisPtr = thisPtr
    nonisolated(unsafe) let argumentsPtr = argumentsPtr
    nonisolated(unsafe) let resultPtr = resultPtr

    // See \`withGuaranteedContext\` for why neither the context nor the runtime is retained here, and
    // why the result is written to the caller's slot instead of being returned.
    return withGuaranteedContext(context) { (context: HostFunctionContext, runtime) in
      return JavaScriptActor.assumeIsolated {
        return forwardingSwiftErrorsToJS(runtime: runtime) {
          let this = UnsafeMutablePointer(mutating: thisPtr).move()
          let arguments = JavaScriptValuesBuffer(runtime, start: argumentsPtr, count: argumentsCount)
          let thisValue = JavaScriptValue(runtime, this)
          try context.call(thisValue, consume arguments).writeJSIValue(to: resultPtr)`,
    `    let callPtrs = Xcode26UncheckedSendable(value: (thisPtr, argumentsPtr, resultPtr))

    // See \`withGuaranteedContext\` for why neither the context nor the runtime is retained here, and
    // why the result is written to the caller's slot instead of being returned.
    return withGuaranteedContext(context) { (context: HostFunctionContext, runtime) in
      return JavaScriptActor.assumeIsolated {
        return forwardingSwiftErrorsToJS(runtime: runtime) {
          let (thisPtr, argumentsPtr, resultPtr) = callPtrs.value
          let this = UnsafeMutablePointer(mutating: thisPtr).move()
          let arguments = JavaScriptValuesBuffer(runtime, start: argumentsPtr, count: argumentsCount)
          let thisValue = JavaScriptValue(runtime, this)
          try context.call(thisValue, consume arguments).writeJSIValue(to: resultPtr)`,
  );

  next = next.replace(
    `    nonisolated(unsafe) let thisPtr = thisPtr
    nonisolated(unsafe) let argumentsPtr = argumentsPtr
    nonisolated(unsafe) let resultPtr = resultPtr

    // See \`withGuaranteedContext\` for why neither the context nor the runtime is retained here, and
    // why the result is written to the caller's slot instead of being returned.
    return withGuaranteedContext(context) { (context: UnownedThisHostFunctionContext, runtime) in
      return JavaScriptActor.assumeIsolated {
        return forwardingSwiftErrorsToJS(runtime: runtime) {
          let arguments = JavaScriptValuesBuffer(runtime, start: argumentsPtr, count: argumentsCount)
          let thisValue = JavaScriptUnownedValue(runtime.pointee, thisPtr)
          try context.call(thisValue, consume arguments).writeJSIValue(to: resultPtr)`,
    `    let callPtrs = Xcode26UncheckedSendable(value: (thisPtr, argumentsPtr, resultPtr))

    // See \`withGuaranteedContext\` for why neither the context nor the runtime is retained here, and
    // why the result is written to the caller's slot instead of being returned.
    return withGuaranteedContext(context) { (context: UnownedThisHostFunctionContext, runtime) in
      return JavaScriptActor.assumeIsolated {
        return forwardingSwiftErrorsToJS(runtime: runtime) {
          let (thisPtr, argumentsPtr, resultPtr) = callPtrs.value
          let arguments = JavaScriptValuesBuffer(runtime, start: argumentsPtr, count: argumentsCount)
          let thisValue = JavaScriptUnownedValue(runtime.pointee, thisPtr)
          try context.call(thisValue, consume arguments).writeJSIValue(to: resultPtr)`,
  );

  if (!next.includes('Xcode26UncheckedSendable(value:')) {
    throw new Error('JavaScriptRuntime.swift pointer captures were not patched');
  }

  const helper = `
private struct Xcode26UncheckedSendable<Value>: @unchecked Sendable {
  let value: Value
}

`;

  return next.replace('\nprivate func createFunctionClosure(\n', `${helper}private func createFunctionClosure(\n`);
});
