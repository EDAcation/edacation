import path from 'path';
import {parseArgs} from 'string-args-parser';

import {FILE_EXTENSIONS_VERILOG} from '../util.js';

import type {IVerilogOptions, ProjectConfiguration, WorkerOptions, WorkerStep} from './configuration.js';
import type {Project} from './project.js';
import {getCombined, getOptions, getTarget, getTargetFile} from './target.js';

// Empty for now
export type IVerilogStep = WorkerStep;

export type IVerilogWorkerOptions = WorkerOptions<IVerilogStep, IVerilogOptions>;

const DEFAULT_OPTIONS: IVerilogOptions = {
    testbenchFile: undefined
};

export const parseIVerilogArguments = (args: string[]) => args.flatMap((arg) => parseArgs(arg));

export const getIVerilogOptions = (configuration: ProjectConfiguration, targetId: string): IVerilogOptions =>
    getOptions(configuration, targetId, 'iverilog', DEFAULT_OPTIONS);

export const getIVerilogWorkerOptions = (
    project: Project,
    targetId: string
): IVerilogWorkerOptions => {
    const configuration = project.getConfiguration();
    const target = getTarget(configuration, targetId);
    const options = getIVerilogOptions(configuration, targetId);

    // Input files
    const designFiles = project.getInputFiles().filter(
        (inputFile) =>
            inputFile.type === 'design' && FILE_EXTENSIONS_VERILOG.includes(path.extname(inputFile.path).substring(1))
    ).map(file => file.path);

    let testbenchFile = options.testbenchFile;
    if (!testbenchFile) {
        // Auto-select from testbench input files
        const allTestbenches = project.getInputFiles().filter((file) => file.type === 'testbench');
        if (allTestbenches.length === 0)
            throw new Error('Could not auto-select testbench file: no input files marked as such');
        testbenchFile = allTestbenches[0].path;
    }

    const generatedInputFiles = designFiles.concat([testbenchFile]);
    const inputFiles = getCombined(
        project.getConfiguration(),
        targetId,
        'iverilog',
        'inputFiles',
        generatedInputFiles
    ).filter((f) => !!f);

    // Output files
    const compiledFile = getTargetFile(target, 'simulator.vvp');
    const generatedOutputFiles: string[] = [compiledFile, `${path.parse(testbenchFile).name}.vcd`];
    const outputFiles = getCombined(
        project.getConfiguration(),
        targetId,
        'iverilog',
        'outputFiles',
        generatedOutputFiles
    ).filter((f) => !!f);

    // Args
    const generatedCompileArgs: string[] = [
        '-o', compiledFile,
        ...designFiles,
        testbenchFile,
    ];
    const compileArgs = getCombined(
        project.getConfiguration(),
        targetId,
        'iverilog',
        'arguments',
        generatedCompileArgs,
        parseIVerilogArguments
    );

    return {
        inputFiles,
        outputFiles,
        target,
        options,
        steps: [
            {
                id: 'iverilog',
                tool: 'iverilog',
                arguments: compileArgs
            },
            {
                id: 'vvp',
                tool: 'vvp',
                arguments: [compiledFile]
            }
        ]
    };
};
