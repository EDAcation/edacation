#!/usr/bin/env node
import {mkdir, readFile, unlink, writeFile} from 'fs/promises';
import path from 'path';
import type {Argv} from 'yargs';
import {hideBin} from 'yargs/helpers';
import yargs from 'yargs/yargs';

import {Project, VENDORS, getNextpnrWorkerOptions, getYosysWorkerOptions} from '../project/index.js';
import {formatArguments} from '../util.js';

import {executeTool} from './tool.js';
import {exists} from './util.js';

// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async () => {
    console.log('EDAcation CLI');
    console.log();

    const buildCommandArgs = (yargs: Argv) => {
        return yargs
            .positional('project', {
                type: 'string',
                description: 'EDA project file (e.g. "full-adder.edaproject")'
            })
            .positional('target', {
                type: 'string',
                description: 'EDA target'
            })
            .option('execute', {
                type: 'boolean',
                description: 'Whether to execute the tool.',
                default: true,
                alias: 'x'
            });
    };

    // Parse arguments
    const argv = await yargs(hideBin(process.argv))
        .scriptName('edacation')
        .command('init <project>', 'Initialize EDA project', (yargs) => {
            return yargs
                .positional('project', {
                    type: 'string',
                    description: 'EDA project file (e.g. "full-adder.edaproject")'
                })
                .option('name', {
                    type: 'string',
                    description: 'Name of the project (e.g. "Full Adder")'
                });
        })
        .command('yosys <project> <target>', 'Synthesize with Yosys', buildCommandArgs)
        .command('nextpnr <project> <target>', 'Place and route with nextpnr', buildCommandArgs)
        .demandCommand()
        .recommendCommands()
        .strict()
        .help()
        .parse();

    const command = argv._[0];

    // Validate project
    const cwdPath = path.resolve(process.cwd());
    let projectFile = argv.project as string;
    let projectPath = path.join(cwdPath, projectFile);

    if (command === 'init') {
        if (!projectPath.endsWith('.edaproject')) {
            projectFile = `${projectFile}.edaproject`;
            projectPath = `${projectPath}.edaproject`;
        }

        if (await exists(projectPath)) {
            console.error(`Project "${projectFile}" already exists in "${cwdPath}".`);
            process.exit(1);
        }

        let name = argv.name as string;
        if (!name) {
            name = path.basename(projectPath);
            name = name.substring(0, name.length - '.edaproject'.length);
        }

        const project = new Project(name);
        await writeFile(projectPath, Project.storeToData(project));

        console.log(`Created project "${name}" in "${projectPath}".`);

        process.exit(0);
    }

    if (!(await exists(projectPath))) {
        if (projectPath.endsWith('.edaproject')) {
            console.error(`Project "${projectFile}" could not be found in "${cwdPath}".`);
            process.exit(1);
        } else {
            projectPath = `${projectPath}.edaproject`;

            if (!(await exists(projectPath))) {
                console.error(
                    `Project "${projectFile}" or "${projectFile}.edaproject" could not be found in "${cwdPath}".`
                );
                process.exit(1);
            }
        }
    }

    const cwd = path.dirname(projectPath);

    const shouldExecute = argv.execute as boolean;
    const targetId = argv.target as string;

    // Load project
    const project = Project.loadFromData(await readFile(projectPath));
    const configuration = project.getConfiguration();

    console.log(`Loaded project "${project.getName()}".`);

    const targetNumber = parseInt(targetId);

    const target = configuration.targets.find((target, index) => target.id === targetId || index + 1 === targetNumber);
    if (!target) {
        const targetsText = `${configuration.targets
            .map((target, index) => `${index + 1}. ${target.id} (${target.name})`)
            .join('\n')}`;
        console.error(`Target "${targetId}" does not exist.\n\nAvailable targets:\n${targetsText}`);
        process.exit(1);
    }

    console.log(`Loaded target "${target.name}".`);
    console.log();

    const vendor = VENDORS[target.vendor];
    const family = vendor.families[target.family];
    const device = family.devices[target.device];
    const packageName = vendor.packages[target.package];

    console.log(`Vendor:  ${vendor.name}`);
    console.log(`Family:  ${family.name}`);
    console.log(`Device:  ${device.name}`);
    console.log(`Package: ${packageName}`);
    console.log();

    // Create output directory if necessary
    if (shouldExecute) {
        const targetDirectory = path.join(cwd, target.directory ?? '.');
        if (!(await exists(targetDirectory))) {
            await mkdir(targetDirectory, {
                recursive: true
            });
        }
    }

    if (command === 'yosys') {
        const workerOptions = getYosysWorkerOptions(project, target.id);

        console.log([workerOptions.tool, ''].concat(workerOptions.commands).join('\n'));
        console.log();

        if (shouldExecute) {
            const designFilePath = path.join(cwd, 'design.ys');
            await writeFile(designFilePath, workerOptions.commands.concat(['']).join('\n'), {encoding: 'utf-8'});

            await executeTool(workerOptions.tool, ['design.ys'], cwd);

            await unlink(designFilePath);
        }
    } else if (command === 'nextpnr') {
        const workerOptions = getNextpnrWorkerOptions(project, target.id);

        console.log([workerOptions.tool].concat(formatArguments(workerOptions.arguments)).join('\n'));
        console.log();

        if (shouldExecute) {
            await executeTool(workerOptions.tool, workerOptions.arguments, cwd);
        }
    } else {
        console.error(`Unknown command "${command}".`);
        process.exit(1);
    }
})();
