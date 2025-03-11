import path from 'path';

import {FILE_EXTENSIONS_HDL, FILE_EXTENSIONS_VERILOG, FILE_EXTENSIONS_VHDL} from '../util.js';

import type {ProjectConfiguration, WorkerOptions, WorkerStep, YosysOptions} from './configuration.js';
import {type Architecture, VENDORS} from './devices.js';
import type {Project} from './project.js';
import {getCombined, getDefaultOptions, getOptions, getTarget, getTargetFile} from './target.js';

export interface YosysStep extends WorkerStep {
    commands: string[];
}

export type YosysWorkerOptions = WorkerOptions<YosysStep, YosysOptions>;

const DEFAULT_OPTIONS: YosysOptions = {
    optimize: true
};

const getFileIngestCommands = (inputFiles: string[], options: YosysOptions): string[] => {
    const commands: string[] = [];

    // Load vhdl files
    const vhdlFiles = inputFiles.filter((file) => FILE_EXTENSIONS_VHDL.includes(path.extname(file).substring(1)));
    if (vhdlFiles.length) {
        if (!options.topLevelModule) {
            throw new Error('Top level module must be defined when synthesizing VHDL');
        }

        commands.push('plugin -i ghdl', `ghdl ${vhdlFiles.join(' ')} -e ${options.topLevelModule}`);
    }

    // Load verilog files
    const verilogFiles = inputFiles.filter((file) => FILE_EXTENSIONS_VERILOG.includes(path.extname(file).substring(1)));
    if (verilogFiles.length) {
        commands.push(...verilogFiles.map((file) => `read_verilog -sv "${file}"`));
    }

    // (auto-)set top-level module
    if (options.topLevelModule) {
        commands.push(`hierarchy -top ${options.topLevelModule}`);
    } else {
        commands.push('hierarchy -auto-top');
    }

    return commands;
};

const getSynthCommands = (arch: Architecture, outFile: string): string[] => {
    const commands: string[] = [];
    if (arch === 'generic') {
        commands.push('synth;');
        commands.push(`write_json "${outFile}";`);
    } else {
        commands.push(`synth_${arch} -json "${outFile}";`);
    }

    return commands;
};

export const getYosysDefaultOptions = (configuration: ProjectConfiguration): YosysOptions =>
    getDefaultOptions(configuration, 'yosys', DEFAULT_OPTIONS);

export const getYosysOptions = (configuration: ProjectConfiguration, targetId: string): YosysOptions =>
    getOptions(configuration, targetId, 'yosys', DEFAULT_OPTIONS);

export const generateYosysWorkerOptions = (
    configuration: ProjectConfiguration,
    projectInputFiles: string[],
    targetId: string
): YosysWorkerOptions => {
    const target = getTarget(configuration, targetId);
    const options = getYosysOptions(configuration, targetId);

    const vendor = VENDORS[target.vendor];
    const family = vendor.families[target.family];

    const inputFiles = projectInputFiles.filter((inputFile) =>
        FILE_EXTENSIONS_HDL.includes(path.extname(inputFile).substring(1))
    );
    const outputFiles = [getTargetFile(target, `${family.architecture}.json`)];

    const tool = 'yosys';
    const commands = [...getFileIngestCommands(inputFiles, options), 'proc;'];

    if (options.optimize) {
        commands.push('opt;');
    }

    commands.push(...getSynthCommands(family.architecture, outputFiles[0]));

    return {
        inputFiles,
        outputFiles,
        target,
        options,
        steps: [
            {
                tool,
                arguments: [],
                commands
            }
        ]
    };
};

export const getYosysWorkerOptions = (project: Project, targetId: string): YosysWorkerOptions => {
    const generated = generateYosysWorkerOptions(project.getConfiguration(), project.getInputFiles(), targetId);

    const inputFiles = getCombined(
        project.getConfiguration(),
        targetId,
        'yosys',
        'inputFiles',
        generated.inputFiles
    ).filter((f) => !!f);
    const outputFiles = getCombined(
        project.getConfiguration(),
        targetId,
        'yosys',
        'outputFiles',
        generated.outputFiles
    ).filter((f) => !!f);

    const target = generated.target;
    const options = generated.options;
    const steps = generated.steps.map((step) => {
        const tool = step.tool;
        const args = step.arguments;
        const commands = getCombined(project.getConfiguration(), targetId, 'yosys', 'commands', step.commands);
        return {tool, arguments: args, commands};
    });

    return {
        inputFiles,
        outputFiles,
        target,
        options,
        steps
    };
};

export const generateYosysRTLCommands = (workerOptions: YosysWorkerOptions): string[] => {
    // Yosys commands taken from yosys2digitaljs (https://github.com/tilk/yosys2digitaljs/blob/1b4afeae61/src/index.js#L1225)

    return [
        ...getFileIngestCommands(workerOptions.inputFiles, workerOptions.options),
        'proc;',
        'opt;',
        'memory -nomap;',
        'wreduce -memx;',
        'opt -full;',
        `tee -q -o ${getTargetFile(workerOptions.target, 'stats.yosys.json')} stat -json -width *;`,
        `write_json "${getTargetFile(workerOptions.target, 'rtl.yosys.json')}";`,
        ''
    ];
};

export const generateYosysSynthPrepareCommands = (workerOptions: YosysWorkerOptions): string[] => {
    return [
        ...getFileIngestCommands(workerOptions.inputFiles, workerOptions.options),
        'proc;',
        'opt;',
        `write_json "${getTargetFile(workerOptions.target, 'presynth.yosys.json')}";`,
        ''
    ];
};

export const generateYosysSynthCommands = (workerOptions: YosysWorkerOptions): string[] => {
    const target = workerOptions.target;
    const vendor = VENDORS[target.vendor];
    const family = vendor.families[target.family];

    return [
        `read_json "${getTargetFile(workerOptions.target, 'presynth.yosys.json')}"`,
        ...getSynthCommands(family.architecture, workerOptions.outputFiles[0]),
        ''
    ];
};
