import {parseArgs} from 'string-args-parser';

import type {NextpnrOptions, ProjectConfiguration} from './configuration.js';
import {VENDORS} from './devices.js';
import type {Project} from './project.js';
import {getCombined, getOptions, getTarget, getTargetFile} from './target.js';

export interface NextpnrWorkerOptions {
    inputFiles: string[];
    outputFiles: string[];
    tool: string;
    arguments: string[];
}

const DEFAULT_OPTIONS: NextpnrOptions = {
    placedSvg: true,
    routedSvg: true,
    routedJson: true
};

export const generateNextpnrWorkerOptions = (
    configuration: ProjectConfiguration,
    targetId: string
): NextpnrWorkerOptions => {
    const target = getTarget(configuration, targetId);
    const options = getOptions(configuration, targetId, 'nextpnr', DEFAULT_OPTIONS);

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
            break;
        }
        case 'nexus': {
            const packageLookup = {
                WLCSP72: 'UWG72',
                QFN72: 'SG72',
                csfBGA121: 'MG121',
                caBGA256: 'BG256',
                csfBGA289: 'MG289',
                caBGA400: 'BG400'
            };

            if (target.package in packageLookup) {
                throw new Error(`Package "${target.package}" is currenty not supported.`);
            }

            args.push('--device', `${device.device}-7${packageLookup[target.package]}C`);
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
        tool,
        arguments: args
    };
};

export const parseNextpnrArguments = (args: string[]) => args.flatMap((arg) => parseArgs(arg));

export const getNextpnrWorkerOptions = (project: Project, targetId: string): NextpnrWorkerOptions => {
    const generated = generateNextpnrWorkerOptions(project.getConfiguration(), targetId);

    const inputFiles = getCombined(project.getConfiguration(), targetId, 'nextpnr', 'inputFiles', generated.inputFiles);
    const outputFiles = getCombined(
        project.getConfiguration(),
        targetId,
        'nextpnr',
        'outputFiles',
        generated.outputFiles
    );

    const tool = generated.tool;
    const args = getCombined(
        project.getConfiguration(),
        targetId,
        'nextpnr',
        'arguments',
        generated.arguments,
        parseNextpnrArguments
    );

    return {
        inputFiles,
        outputFiles,
        tool,
        arguments: args
    };
};
