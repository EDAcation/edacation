import path from 'path';

import {FILE_EXTENSIONS_HDL, FILE_EXTENSIONS_VERILOG, FILE_EXTENSIONS_VHDL} from '../util.js';

import type {ProjectConfiguration, WorkerOptions, WorkerStep, YosysOptions} from './configuration.js';
import {VENDORS} from './devices.js';
import type {Project} from './project.js';
import {getCombined, getOptions, getTarget, getTargetFile} from './target.js';

export interface YosysStep extends WorkerStep {
    commands: string[];
}

export type YosysWorkerOptions = WorkerOptions<YosysStep, YosysOptions>;

const DEFAULT_OPTIONS: YosysOptions = {
    optimize: true
};

export const getYosysOptions = (configuration: ProjectConfiguration, targetId: string): YosysOptions =>
    getOptions(configuration, targetId, 'yosys', DEFAULT_OPTIONS);

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

const getInputFiles = (project: Project, targetId: string): string[] => {
    const generatedInputFiles = project.getInputFiles()
        .filter(
            (inputFile) =>
                inputFile.type === 'design' && FILE_EXTENSIONS_HDL.includes(path.extname(inputFile.path).substring(1))
        )
        .map((file) => file.path);

    return getCombined(
        project.getConfiguration(),
        targetId,
        'yosys',
        'inputFiles',
        generatedInputFiles
    ).filter((f) => !!f);
}

const getOutputFiles = (project: Project, targetId: string, files: string[]): string[] => {
    const target = project.getTarget(targetId);
    if (target === null) throw new Error('Target not found');

    const generatedOutputFiles = files.map(f => getTargetFile(target.config, f));
    return getCombined(
        project.getConfiguration(),
        targetId,
        'yosys',
        'outputFiles',
        generatedOutputFiles
    ).filter((f) => !!f);
}

export const getYosysRTLWorkerOptions = (project: Project, targetId: string): YosysWorkerOptions => {
    const configuration = project.getConfiguration();
    const target = getTarget(configuration, targetId);
    const options = getYosysOptions(configuration, targetId);

    // Input files
    const inputFiles = getInputFiles(project, targetId);

    // Output files
    const outputFiles = getOutputFiles(project, targetId, ["stats.yosys.json", "rtl.yosys.json"]);

    // Commands
    const generatedCommands = [
        ...getFileIngestCommands(inputFiles, options),
        'proc;',
        'opt;',
        'memory -nomap;',
        'wreduce -memx;',
        'opt -full;',
        `tee -q -o "${getTargetFile(target, 'stats.yosys.json')}" stat -json -width *;`,
        `write_json "${getTargetFile(target, 'rtl.yosys.json')}";`,
        ''
    ];
    const commands = getCombined(project.getConfiguration(), targetId, 'yosys', 'rtlCommands', generatedCommands);

    return {
        inputFiles,
        outputFiles,
        target,
        options,
        steps: [
            {
                id: 'rtl',
                tool: 'yosys',
                arguments: [],
                commands
            }
        ]
    };
};

export const getYosysSynthesisWorkerOptions = (project: Project, targetId: string): YosysWorkerOptions => {
    const configuration = project.getConfiguration();
    const target = getTarget(configuration, targetId);
    const options = getYosysOptions(configuration, targetId);

    const vendor = VENDORS[target.vendor];
    const family = vendor.families[target.family];

    // Input files
    const inputFiles = getInputFiles(project, targetId);

    // Output files
    const outputFiles = getOutputFiles(project, targetId, [`${family.architecture}.json`]);

    // Commands (preparation)
    const generatedPrepareCommands = [
        ...getFileIngestCommands(inputFiles, options),
        'proc;',
        'opt;',
        `write_json "${getTargetFile(target, 'presynth.yosys.json')}";`,
        ''
    ];
    const prepareCommands = getCombined(project.getConfiguration(), targetId, 'yosys', 'synthPrepareCommands', generatedPrepareCommands);

    // Commands (synthesis)
    const generatedSynthCommands = [
        `read_json "${getTargetFile(target, 'presynth.yosys.json')}"`,
    ];
    if (family.architecture === 'generic') {
        generatedSynthCommands.push('synth;');
        generatedSynthCommands.push(`write_json "${family.architecture}.json";`);
    } else {
        generatedSynthCommands.push(`synth_${family.architecture} -json "${family.architecture}.json";`);
    }
    generatedSynthCommands.push('');
    const synthCommands = getCombined(project.getConfiguration(), targetId, 'yosys', 'synthCommands', generatedSynthCommands);

    return {
        inputFiles,
        outputFiles,
        target,
        options,
        steps: [
            {
                id: 'prepare',
                tool: 'yosys',
                arguments: [],
                commands: prepareCommands
            },
            {
                id: 'synth',
                tool: 'yosys',
                arguments: [],
                commands: synthCommands
            }
        ]
    };
};
