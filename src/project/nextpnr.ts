import {parseArgs} from 'string-args-parser';

import type {NextpnrOptions, ProjectConfiguration, WorkerOptions, WorkerStep} from './configuration.js';
import {VENDORS} from './devices.js';
import type {Project} from './project.js';
import {getCombined, getDefaultOptions, getOptions, getTarget, getTargetFile} from './target.js';

export interface NextpnrStep extends WorkerStep {
    arguments: string[];
}

export type NextpnrWorkerOptions = WorkerOptions<NextpnrStep, NextpnrOptions>;

const DEFAULT_OPTIONS: NextpnrOptions = {
    placedSvg: false,
    routedSvg: false,
    routedJson: true
};

export const getNextpnrDefaultOptions = (configuration: ProjectConfiguration): NextpnrOptions =>
    getDefaultOptions(configuration, 'nextpnr', DEFAULT_OPTIONS);

export const getNextpnrOptions = (configuration: ProjectConfiguration, targetId: string): NextpnrOptions =>
    getOptions(configuration, targetId, 'nextpnr', DEFAULT_OPTIONS);

export const generateNextpnrWorkerOptions = (
    configuration: ProjectConfiguration,
    targetId: string
): NextpnrWorkerOptions => {
    const target = getTarget(configuration, targetId);
    const options = getNextpnrOptions(configuration, targetId);

    const vendor = VENDORS[target.vendor];
    const family = vendor.families[target.family];
    const device = family.devices[target.device];

    const inputFiles = [getTargetFile(target, `${family.architecture}.json`)];

    const outputFiles: string[] = [];

    const tool = `nextpnr-${family.architecture}`;
    const args: string[] = [];

    switch (family.architecture) {
        case 'ecp5': {
            args.push(`--${device.device}`);
            args.push('--package', target.package.toUpperCase());
            break;
        }
        case 'generic': {
            break;
        }
        case 'gowin': {
            args.push('--device', `${device.device.replace('-', '-UV')}${target.package}C5/I4`);
            break;
        }
        case 'ice40': {
            args.push(`--${device.device}`);
            args.push('--package', target.package);

            // Write ASC file by default
            const file = getTargetFile(target, `${family.architecture}.asc`);
            outputFiles.push(file);
            args.push('--asc', `${family.architecture}.asc`);
            break;
        }
        case 'nexus': {
            const packageLookup: Record<string, string> = {
                WLCSP72: 'UWG72',
                QFN72: 'SG72',
                csfBGA121: 'MG121',
                caBGA256: 'BG256',
                csfBGA289: 'MG289',
                caBGA400: 'BG400'
            };

            const devPackage = packageLookup[target.package];
            if (!devPackage) {
                throw new Error(`Package "${target.package}" is currenty not supported.`);
            }

            args.push('--device', `${device.device}-7${devPackage}C`);
            break;
        }
        default: {
            throw new Error(`Architecture "${family.architecture}" is currently not supported.`);
        }
    }

    args.push('--json', inputFiles[0]);

    if (options.placedSvg) {
        const file = getTargetFile(target, 'placed.svg');
        outputFiles.push(file);
        args.push('--placed-svg', file);
    }
    if (options.routedSvg) {
        const file = getTargetFile(target, 'routed.svg');
        outputFiles.push(file);
        args.push('--routed-svg', file);
    }
    if (options.routedJson) {
        const file = getTargetFile(target, 'routed.nextpnr.json');
        outputFiles.push(file);
        args.push('--write', file);
    }

    return {
        inputFiles,
        outputFiles,
        target,
        options,
        steps: [
            {
                tool,
                arguments: args
            }
        ]
    };
};

export const parseNextpnrArguments = (args: string[]) => args.flatMap((arg) => parseArgs(arg));

export const getNextpnrWorkerOptions = (project: Project, targetId: string): NextpnrWorkerOptions => {
    const generated = generateNextpnrWorkerOptions(project.getConfiguration(), targetId);

    const inputFiles = getCombined(
        project.getConfiguration(),
        targetId,
        'nextpnr',
        'inputFiles',
        generated.inputFiles
    ).filter((f) => !!f);
    const outputFiles = getCombined(
        project.getConfiguration(),
        targetId,
        'nextpnr',
        'outputFiles',
        generated.outputFiles
    ).filter((f) => !!f);

    const target = generated.target;
    const options = generated.options;
    const steps = generated.steps.map((step) => {
        const tool = step.tool;
        const args = getCombined(
            project.getConfiguration(),
            targetId,
            'nextpnr',
            'arguments',
            step.arguments,
            parseNextpnrArguments
        );
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
