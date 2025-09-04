const functions = require('./functions');
const renderOp = require('./opRender');

function getFormulaByLine(formula, line) {
  if (!formula) return '';
  const lines = formula.split('\n').map((l) => l.trim());
  return lines[line - 1] || formula;
}

function getErrorMessage(error) {
  let message = error;
  if (error && error.bounce_message !== undefined) {
    message = error.bounce_message;
  }
  if (typeof message === 'string' && message.length > 100) {
    message = message.slice(0, 100) + '...';
  }
  return message;
}

function formatErrorMeta(meta) {
  if (!meta || !meta.arr) return '';
  const arr = meta.arr;
  const op = arr[0];

  if (op === 'bounce') {
    return '';
  }

  if (op === 'comparison') {
    const left = meta.left || {};
    const right = meta.right || {};
    const opSign = meta.op || '';

    const leftCode = renderOp(left.var_name);
    const rightCode = renderOp(right.var_name);

    const leftVal = `${left.val}(${left.type})`;
    const rightVal = `${right.val}(${right.type})`;

    return `${leftCode} ${opSign} ${rightCode}\n${leftVal} ${opSign} ${rightVal}`;
  }

  if (functions.has(op)) {
    return `${op}`;
  }

  return `${renderOp(arr)}`;
}

function formatConsoleTrace(callStack, callStackLines, aaPath, currentLine, aaEnterLines, gettersAA, namedFunc) {
  try {
    const frames = [];
    let topNamed = namedFunc;
    if (!topNamed && Array.isArray(callStack) && callStack.length) {
      for (let i = callStack.length - 1; i >= 0; i--) {
        const nm = callStack[i];
        if (nm && nm !== '<anonymous>') { topNamed = nm; break; }
      }
    }
    if (topNamed) {
      const suffix = currentLine !== undefined ? ` (line: ${currentLine})` : '';
      frames.push(`    at ${topNamed}${suffix}`);
    }
    const path = Array.isArray(aaPath) ? aaPath : [];
    const enterLines = Array.isArray(aaEnterLines) ? aaEnterLines : [];
    if (path.length) {
      const curAA = path[path.length - 1];
      if (gettersAA && gettersAA === curAA) {
        frames.push(`    in getters of AA ${curAA}`);
      }
      for (let i = path.length - 2; i >= 0; i--) {
        const aa = path[i];
        const ln = enterLines[i + 1];
        const suffix = ln !== undefined ? ` (line: ${ln})` : '';
        frames.push(`    at AA ${aa}${suffix}`);
      }
    }
    if (!frames.length) return '';
    return ['Trace:'].concat(frames).join('\n');
  } catch (_) {
    return '';
  }
}

function buildContext(errJson) {
  const aaPath = [];
  const getters = new Map();
  let lastAA = '';
  let lastFormula = '';
  let lastTraceLine = undefined;
  let inFunc = false;
  let dontShowFormat = false;
  const callStack = [];
  const callStackLines = [];
  let stackAtLastLine = [];
  let stackLinesAtLastLine = [];
  const aaEnterLines = [];
  let lastGettersAA = undefined;
  let gettersAAAtLastLine = undefined;
  const snapshotsByLine = Object.create(null);
  let lastNamedFunc = undefined;
  let namedFuncAtLastLine = undefined;

  const trace = Array.isArray(errJson.trace) ? errJson.trace : [];

  for (let i = 0; i < trace.length; i++) {
    const t = trace[i];
    if (t.line !== undefined) {
      lastTraceLine = t.line;
      stackAtLastLine = callStack.slice();
      stackLinesAtLastLine = callStackLines.slice();
      gettersAAAtLastLine = lastGettersAA;
      namedFuncAtLastLine = lastNamedFunc;
      snapshotsByLine[lastTraceLine] = {
        stack: stackAtLastLine,
        stackLines: stackLinesAtLastLine,
        gettersAA: gettersAAAtLastLine,
        namedFunc: namedFuncAtLastLine,
      };
    }

    switch (t.system) {
      case 'enter to func':
        inFunc = true;
        if (t.name) callStack.push(t.name); else callStack.push('<anonymous>');
        callStackLines.push(lastTraceLine);
        if (t.name) lastNamedFunc = t.name;
        break;
      case 'exit from func':
        inFunc = false;
        if (callStack.length) callStack.pop();
        if (callStackLines.length) callStackLines.pop();
        lastNamedFunc = undefined;
        for (let i = callStack.length - 1; i >= 0; i--) {
          const nm = callStack[i];
          if (nm && nm !== '<anonymous>') { lastNamedFunc = nm; break; }
        }
        break;
      case 'enter to aa':
        lastAA = t.aa;
        lastFormula = t.formula;
        if (aaPath.at(-1) !== lastAA) {
          aaPath.push(lastAA);
          aaEnterLines.push(lastTraceLine);
        }
        break;
      case 'enter to getters':
        getters.set(t.aa, t.formula);
        lastGettersAA = t.aa;
        break;
      default:
        break;
    }
  }

  let line = errJson?.meta?.arr?.line;

  if (errJson.error === 'return value missing') {
    dontShowFormat = true;
    const actualMeta = errJson.meta?.arr?.[1]?.at(-1);
    if (actualMeta) {
      line = actualMeta.line;
      errJson.meta = { arr: actualMeta };
    }
  }

  if (line === undefined) {
    line = lastTraceLine;
  }

  if (inFunc) {
    lastFormula = getters.get(lastAA) || lastFormula;
  }

  const targetSnap = snapshotsByLine[line] || undefined;
  const callStackAtTarget = targetSnap?.stack || stackAtLastLine;
  const callStackLinesAtTarget = targetSnap?.stackLines || stackLinesAtLastLine;
  const gettersAAAtTarget = targetSnap?.gettersAA || gettersAAAtLastLine;
  const namedFuncAtTarget = targetSnap?.namedFunc || lastNamedFunc;

  return {
    aaPath,
    lastAA,
    lastFormula,
    line,
    inFunc,
    dontShowFormat,
    callStack: callStackAtTarget,
    callStackLines: callStackLinesAtTarget,
    aaEnterLines,
    gettersAA: gettersAAAtTarget,
    namedFunc: namedFuncAtTarget,
  };
}

function formatError(errJson) {
  const { aaPath, lastAA, lastFormula, line, dontShowFormat, callStack, callStackLines, aaEnterLines, gettersAA, namedFunc } = buildContext(errJson);

  const lines = [
    `Error: ${getErrorMessage(errJson.error)}`,
  ];

  const formattedMeta = formatErrorMeta(errJson.meta);
  if (formattedMeta && !dontShowFormat) {
    lines.push(formattedMeta, '');
  } else {
    lines.push(' ');
  }

  lines.push(`${lastAA}${errJson.xpath}:${line}`);
  lines.push(getFormulaByLine(lastFormula, line));

  const traceBlock = formatConsoleTrace(callStack, callStackLines, aaPath, line, aaEnterLines, gettersAA, namedFunc);
  if (traceBlock) {
    lines.push('', traceBlock);
  }

  return lines.join('\n').trim();
}

module.exports = formatError;
