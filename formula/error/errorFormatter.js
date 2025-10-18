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
	
	if (error && error.message !== undefined) {
		message = error.message;
	}
	
	return message;
}

function formatErrorContext(context) {
	if (!context || !context.arr) return '';
	const arr = context.arr;
	const op = arr[0];
	
	if (op === 'bounce') {
		return '';
	}
	
	if (op === 'comparison') {
		const left = context.left || {};
		const right = context.right || {};
		const opSign = context.op || '';
		
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

function formatConsoleTrace(callStack, aaPath, currentLine, aaEnterLines, gettersAA, namedFunc) {
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
			const frame = { type: 'function', name: topNamed };
			if (currentLine !== undefined) {
				frame.line = currentLine;
			}
			frames.push(frame);
		}
		const path = Array.isArray(aaPath) ? aaPath : [];
		const enterLines = Array.isArray(aaEnterLines) ? aaEnterLines : [];
		if (path.length) {
			const curAA = path[path.length - 1];
			if (gettersAA && gettersAA === curAA) {
				frames.push({ type: 'getter', aa: curAA });
			}
			for (let i = path.length - 2; i >= 0; i--) {
				const aa = path[i];
				const ln = enterLines[i + 1];
				const frame = { type: 'aa', aa };
				if (ln !== undefined) {
					frame.line = ln;
				}
				frames.push(frame);
			}
		}
		if (!frames.length) return null;
		return frames;
	} catch (_) {
		return null;
	}
}

function collectLinesFromArr(arr, lines = new Set()) {
	if (!arr) return lines;
	
	if (Array.isArray(arr)) {
		if (arr.line !== undefined) {
			lines.add(arr.line);
		}
		for (let i = 0; i < arr.length; i++) {
			collectLinesFromArr(arr[i], lines);
		}
	} else if (typeof arr === 'object' && arr !== null) {
		if (arr.line !== undefined) {
			lines.add(arr.line);
		}
		for (const key in arr) {
			if (arr.hasOwnProperty(key) && key !== 'line') {
				collectLinesFromArr(arr[key], lines);
			}
		}
	}
	
	return lines;
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
	let stackAtLastLine = [];
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
			gettersAAAtLastLine = lastGettersAA;
			namedFuncAtLastLine = lastNamedFunc;
			snapshotsByLine[lastTraceLine] = {
				stack: stackAtLastLine,
				gettersAA: gettersAAAtLastLine,
				namedFunc: namedFuncAtLastLine,
			};
		}
		
		switch (t.system) {
			case 'enter to func':
				inFunc = true;
				if (t.name) callStack.push(t.name); else callStack.push('<anonymous>');
				if (t.name) lastNamedFunc = t.name;
				break;
			case 'exit from func':
				inFunc = false;
				if (callStack.length) callStack.pop();
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
	
	let line = errJson?.context?.arr?.line;
	const allLinesFromArr = Array.from(collectLinesFromArr(errJson?.context?.arr)).sort((a, b) => a - b);
	
	if (errJson.error === 'return value missing') {
		dontShowFormat = true;
		const actualContext = errJson.context?.arr?.[1]?.at(-1);
		if (actualContext) {
			line = actualContext.line;
			errJson.context = { arr: actualContext };
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
	const gettersAAAtTarget = targetSnap?.gettersAA || gettersAAAtLastLine;
	const namedFuncAtTarget = targetSnap?.namedFunc || lastNamedFunc;
	
	return {
		aaPath,
		lastAA,
		lastFormula,
		line,
		allLinesFromArr,
		inFunc,
		dontShowFormat,
		callStack: callStackAtTarget,
		aaEnterLines,
		gettersAA: gettersAAAtTarget,
		namedFunc: namedFuncAtTarget,
	};
}

function formatError(errJson) {
	const { aaPath, lastFormula, line, allLinesFromArr, dontShowFormat, callStack, aaEnterLines, gettersAA, namedFunc } = buildContext(errJson);
	
	const message = getErrorMessage(errJson.error)
	
	const formattedContext = !dontShowFormat ? formatErrorContext(errJson.context) : undefined;
	
	const linesToExtract = allLinesFromArr.length > 0 ? allLinesFromArr : (line !== undefined ? [line] : []);
	const lines = linesToExtract.map(lineNum => ({
		line: lineNum,
		formula: getFormulaByLine(lastFormula, lineNum)
	}));
	
	const traceBlock = formatConsoleTrace(callStack, aaPath, line, aaEnterLines, gettersAA, namedFunc);
	
	const result = {
		message,
		lines,
	};

	if (formattedContext) {
		result.formattedContext = formattedContext;
	}

	if (errJson.xpath) {
		result.xpath = errJson.xpath;
	}

	if (traceBlock) {
		result.trace = traceBlock;
	}

	return result;
}

module.exports = formatError;
