import path from 'path';

import {FILE_EXTENSIONS_HDL, FILE_EXTENSIONS_VERILOG} from '../util.js';

import type {ProjectConfiguration, WorkerOptions, YosysOptions} from './configuration.js';
import {type Architecture, VENDORS} from './devices.js';
import type {Project} from './project.js';
import {getCombined, getDefaultOptions, getOptions, getTarget, getTargetFile} from './target.js';

export interface YosysWorkerOptions extends WorkerOptions {
    commands: string[];
    options: YosysOptions;
}

const DEFAULT_OPTIONS: YosysOptions = {
    optimize: true
};

const getSynthCommands = (arch: Architecture, outFile: string): string[] => {
    const commands: string[] = [];
    if (arch === 'generic') {
        commands.push('synth;');
        commands.push(`write_json ${outFile};`);
    } else {
        commands.push(`synth_${arch} -json ${outFile};`);
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
    const outputFiles = [
        getTargetFile(target, `${family.architecture}.json`),
        getTargetFile(target, 'luts.yosys.json')
    ];

    const tool = 'yosys';
    const commands = [...inputFiles.map((file) => `read_verilog -sv ${file}`), 'proc;'];

    if (options.optimize) {
        commands.push('opt;');
    }

    commands.push(...getSynthCommands(family.architecture, outputFiles[0]));

    return {
        inputFiles,
        outputFiles,
        tool,
        target,
        commands,
        options
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

    const tool = generated.tool;
    const target = generated.target;
    const commands = getCombined(project.getConfiguration(), targetId, 'yosys', 'commands', generated.commands);
    const options = generated.options;

    return {
        inputFiles,
        outputFiles,
        tool,
        target,
        commands,
        options
    };
};

export const generateYosysRTLCommands = (workerOptions: YosysWorkerOptions): string[] => {
    const verilogFiles = workerOptions.inputFiles.filter((file) =>
        FILE_EXTENSIONS_VERILOG.includes(path.extname(file).substring(1))
    );

    // Yosys commands taken from yosys2digitaljs (https://github.com/tilk/yosys2digitaljs/blob/1b4afeae61/src/index.js#L1225)

    return [
        ...verilogFiles.map((file) => `read_verilog -sv ${file}`),
        'hierarchy -auto-top;',
        'proc;',
        'opt;',
        'memory -nomap;',
        'wreduce -memx;',
        'opt -full;',
        `tee -q -o ${getTargetFile(workerOptions.target, 'stats.yosys.json')} stat -json -width *;`,
        `write_json ${getTargetFile(workerOptions.target, 'rtl.yosys.json')};`,
        ''
    ];
};

export const generateYosysSynthPrepareCommands = (workerOptions: YosysWorkerOptions): string[] => {
    const verilogFiles = workerOptions.inputFiles.filter((file) =>
        FILE_EXTENSIONS_VERILOG.includes(path.extname(file).substring(1))
    );

    return [
        ...verilogFiles.map((file) => `read_verilog -sv ${file}`),
        'proc;',
        'opt;',
        `write_json ${getTargetFile(workerOptions.target, 'presynth.yosys.json')};`,
        ''
    ];
};

export const generateYosysSynthCommands = (workerOptions: YosysWorkerOptions): string[] => {
    const target = workerOptions.target;
    const vendor = VENDORS[target.vendor];
    const family = vendor.families[target.family];

    return [
        `read_json ${getTargetFile(workerOptions.target, 'presynth.yosys.json')}`,
        ...getSynthCommands(family.architecture, workerOptions.outputFiles[0]),
        '',
        'design -reset',
        '',
        `read_json ${getTargetFile(workerOptions.target, 'presynth.yosys.json')};`,
        'synth -lut 4;',
        `write_json ${workerOptions.outputFiles[1]};`,
        ''
    ];
};
