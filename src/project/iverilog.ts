import path from 'path';
import {parseArgs} from 'string-args-parser';

import {FILE_EXTENSIONS_VERILOG} from '../util.js';

import type {IVerilogOptions, ProjectConfiguration, WorkerOptions, WorkerStep} from './configuration.js';
import type {Project, ProjectInputFile} from './project.js';
import {getCombined, getDefaultOptions, getOptions, getTarget, getTargetFile} from './target.js';

// Empty for now
export type IVerilogStep = WorkerStep;

export type IVerilogWorkerOptions = WorkerOptions<IVerilogStep, IVerilogOptions>;

const DEFAULT_OPTIONS: IVerilogOptions = {};

export const getIVerilogDefaultOptions = (configuration: ProjectConfiguration): IVerilogOptions =>
    getDefaultOptions(configuration, 'iverilog', DEFAULT_OPTIONS);

export const getIVerilogOptions = (configuration: ProjectConfiguration, targetId: string): IVerilogOptions =>
    getOptions(configuration, targetId, 'iverilog', DEFAULT_OPTIONS);

export const generateIVerilogWorkerOptions = (
    configuration: ProjectConfiguration,
    projectInputFiles: ProjectInputFile[],
    targetId: string
): IVerilogWorkerOptions => {
    const target = getTarget(configuration, targetId);
    const options = getIVerilogOptions(configuration, targetId);

    const files = projectInputFiles.filter((inputFile) =>
        FILE_EXTENSIONS_VERILOG.includes(path.extname(inputFile.path).substring(1))
    );
    const designFiles = files.filter((file) => file.type === 'design').map((file) => file.path);
    const testbenchFile = files.filter((file) => file.type === 'testbench').map((file) => file.path)[0]; // TODO: be smarter than using the first file
    const inputFiles = designFiles.concat([testbenchFile]);

    const compiledFile = getTargetFile(target, 'simulator.vvp');
    const outputFiles: string[] = [compiledFile, `${path.parse(testbenchFile).name}.vcd`];

    const compileArgs: string[] = [];
    compileArgs.push('-o', compiledFile);
    compileArgs.push(...designFiles);
    compileArgs.push(testbenchFile);

    const steps = [
        {tool: 'iverilog', arguments: compileArgs},
        {tool: 'vvp', arguments: [compiledFile]}
    ];

    return {
        inputFiles,
        outputFiles,
        target,
        options,
        steps
    };
};

export const parseIVerilogArguments = (args: string[]) => args.flatMap((arg) => parseArgs(arg));

export const getIVerilogWorkerOptions = (project: Project, targetId: string): IVerilogWorkerOptions => {
    const generated = generateIVerilogWorkerOptions(project.getConfiguration(), project.getInputFiles(), targetId);

    const inputFiles = getCombined(
        project.getConfiguration(),
        targetId,
        'iverilog',
        'inputFiles',
        generated.inputFiles
    ).filter((f) => !!f);
    const outputFiles = getCombined(
        project.getConfiguration(),
        targetId,
        'iverilog',
        'outputFiles',
        generated.outputFiles
    ).filter((f) => !!f);

    const target = generated.target;
    const options = generated.options;
    const steps = generated.steps.map((step) => {
        const tool = step.tool;
        const args = getCombined(project.getConfiguration(), targetId, 'iverilog', 'commands', step.arguments);
        return {tool, arguments: args};
    });

    return {
        inputFiles,
        outputFiles,
        target,
        options,
        steps
    };
};
