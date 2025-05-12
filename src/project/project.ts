import {decodeJSON, encodeJSON} from '../util.js';

import {DEFAULT_CONFIGURATION, type ProjectConfiguration, schemaProjectConfiguration} from './configuration.js';

type ProjectTarget = ProjectConfiguration['targets'][number];

export interface ProjectInputFileState {
    path: string;
    type: 'design' | 'testbench';
}

export class ProjectInputFile {
    constructor(
        private _path: ProjectInputFileState['path'],
        private _type: ProjectInputFileState['type']
    ) {}

    get path(): ProjectInputFileState['path'] {
        return this._path;
    }

    get type(): ProjectInputFileState['type'] {
        return this._type;
    }

    set type(type: ProjectInputFileState['type']) {
        this._type = type;
    }

    static serialize(file: ProjectInputFile): ProjectInputFileState {
        return {
            path: file.path,
            type: file.type
        };
    }

    static deserialize(data: ProjectInputFileState | string, ..._args: unknown[]): ProjectInputFile {
        // Older versions of this module (<= 0.3.9) stored input files as an array of paths instead,
        // so we need to migrate if data is a string (single output file).
        if (typeof data === 'string') {
            data = {path: data, type: 'design'};
        }

        return new ProjectInputFile(data.path, data.type);
    }
}

export interface ProjectOutputFileState {
    path: string;
    targetId: string | null;
    stale: boolean;
}

export class ProjectOutputFile {
    constructor(
        private _project: Project,
        private _path: ProjectOutputFileState['path'],
        private _targetId: ProjectOutputFileState['targetId'] = null,
        private _stale: ProjectOutputFileState['stale'] = false
    ) {}

    get path(): ProjectOutputFileState['path'] {
        return this._path;
    }

    get targetId(): ProjectOutputFileState['targetId'] {
        return this._targetId;
    }

    set targetId(id: ProjectOutputFileState['targetId']) {
        if (id !== null && this._project.getTarget(id) === null) {
            throw new Error(`Invalid target id: ${id}`);
        }
        this._targetId = id;
    }

    get target(): ProjectTarget | null {
        if (!this._targetId) return null;
        return this._project.getTarget(this._targetId);
    }

    get stale(): ProjectOutputFileState['stale'] {
        return this._stale;
    }

    set stale(isStale: ProjectOutputFileState['stale']) {
        this._stale = isStale;
    }

    static serialize(file: ProjectOutputFile): ProjectOutputFileState {
        return {
            path: file.path,
            targetId: file.targetId,
            stale: file.stale
        };
    }

    static deserialize(project: Project, data: ProjectOutputFileState | string, ..._args: unknown[]) {
        // Older versions of this module (<= 0.3.12) stored output files as an array of paths instead,
        // so we need to migrate if data is a string (single output file).
        if (typeof data === 'string') {
            data = {path: data, targetId: null, stale: false};
        }

        return new ProjectOutputFile(project, data.path, data.targetId, data.stale);
    }
}

export interface ProjectState {
    name: string;
    inputFiles: ProjectInputFileState[] | string[];
    outputFiles: ProjectOutputFileState[] | string[];
    configuration: ProjectConfiguration;
}

interface ProjectEvents {
    onInputFileChange?: (inputFiles: ProjectInputFile[]) => void;
    onOutputFileChange?: (outputFiles: ProjectOutputFile[]) => void;
    onConfigurationChange?: (configuration: ProjectConfiguration) => void;
}

export class Project {
    private name: string;
    private inputFiles: ProjectInputFile[];
    private outputFiles: ProjectOutputFile[];
    private configuration: ProjectConfiguration;
    private events: ProjectEvents | null;

    constructor(
        name: string,
        inputFiles: ProjectInputFileState[] | string[] = [],
        outputFiles: ProjectOutputFileState[] | string[] = [],
        configuration: ProjectConfiguration = DEFAULT_CONFIGURATION,
        events: ProjectEvents = {}
    ) {
        this.name = name;
        this.inputFiles = inputFiles.map((file: ProjectInputFileState | string) => ProjectInputFile.deserialize(file));
        this.outputFiles = outputFiles.map((file: ProjectOutputFileState | string) =>
            ProjectOutputFile.deserialize(this, file)
        );
        this.events = events;

        const config = schemaProjectConfiguration.safeParse(configuration);
        if (config.success) {
            this.configuration = config.data;
        } else {
            throw new Error(`Failed to parse project configuration: ${config.error.toString()}`);
        }

        // Trigger a config 'update' to deploy any modifications it might want to make
        this.updateConfiguration({}, false);
    }

    getName() {
        return this.name;
    }

    getInputFiles() {
        return this.inputFiles;
    }

    hasInputFile(filePath: string) {
        return this.getInputFile(filePath) !== null;
    }

    getInputFile(filePath: string): ProjectInputFile | null {
        return this.inputFiles.find((file) => file.path === filePath) ?? null;
    }

    addInputFiles(files: {path: string; type?: ProjectInputFileState['type']}[]) {
        for (const file of files) {
            if (!this.hasInputFile(file.path)) {
                const inputFile = new ProjectInputFile(file.path, file.type ?? 'design');
                this.inputFiles.push(inputFile);
            }
        }

        this.inputFiles.sort((a, b) => {
            return a < b ? -1 : 1;
        });

        if (this.events?.onInputFileChange) this.events.onInputFileChange(this.inputFiles);
    }

    removeInputFiles(filePaths: string[]) {
        this.inputFiles = this.inputFiles.filter((file) => !filePaths.includes(file.path));

        if (this.events?.onInputFileChange) this.events.onInputFileChange(this.inputFiles);
    }

    getOutputFiles() {
        return this.outputFiles;
    }

    hasOutputFile(filePath: string): boolean {
        return this.getOutputFile(filePath) !== null;
    }

    getOutputFile(filePath: string): ProjectOutputFile | null {
        return this.outputFiles.find((file) => file.path === filePath) ?? null;
    }

    addOutputFiles(files: {path: string; targetId: string}[]) {
        for (const file of files) {
            const existingOutFile = this.getOutputFile(file.path);
            if (existingOutFile) {
                // File already exists, so we don't want to add it again.
                // But, we should make sure the target ID gets updated and set `stale` to false.
                existingOutFile.targetId = file.targetId;
                existingOutFile.stale = false;
                continue;
            }

            const outputFile = new ProjectOutputFile(this, file.path, file.targetId);
            if (outputFile.target === null) throw new Error(`Invalid target ID: ${file.targetId}`);
            this.outputFiles.push(outputFile);
        }

        this.outputFiles.sort((a, b) => {
            return a < b ? -1 : 1;
        });

        if (this.events?.onOutputFileChange) this.events.onOutputFileChange(this.outputFiles);
    }

    removeOutputFiles(filePaths: string[]) {
        this.outputFiles = this.outputFiles.filter((file) => !filePaths.includes(file.path));

        if (this.events?.onOutputFileChange) this.events.onOutputFileChange(this.outputFiles);
    }

    expireOutputFiles() {
        for (const file of this.outputFiles) {
            file.stale = true;
        }

        if (this.events?.onOutputFileChange) this.events.onOutputFileChange(this.outputFiles);
    }

    getConfiguration() {
        return this.configuration;
    }

    updateConfiguration(configuration: Partial<ProjectConfiguration>, doTriggerEvent = true) {
        this.configuration = {
            ...this.configuration,
            ...configuration
        };

        // Unset 'lingering' output file target IDs
        for (const outFile of this.outputFiles) {
            if (!outFile.target) outFile.targetId = null;
        }

        if (doTriggerEvent && this.events?.onConfigurationChange) this.events.onConfigurationChange(this.configuration);
    }

    getTarget(id: string): ProjectTarget | null {
        const targets = this.configuration.targets;
        return targets.find((target) => target.id === id) ?? null;
    }

    static serialize(project: Project): ProjectState {
        return {
            name: project.name,
            inputFiles: project.inputFiles.map((file) => ProjectInputFile.serialize(file)),
            outputFiles: project.outputFiles.map((file) => ProjectOutputFile.serialize(file)),
            configuration: project.configuration
        };
    }

    static deserialize(data: ProjectState, ..._args: unknown[]): Project {
        const name: string = data.name;
        const inputFiles: ProjectInputFileState[] | string[] = data.inputFiles ?? [];
        const outputFiles: ProjectOutputFileState[] | string[] = data.outputFiles ?? [];
        const configuration: ProjectConfiguration = data.configuration ?? {};

        return new Project(name, inputFiles, outputFiles, configuration);
    }

    static loadFromData(rawData: Uint8Array): Project {
        const data = decodeJSON(rawData);
        const project = Project.deserialize(data as ProjectState);
        return project;
    }

    static storeToData(project: Project): Uint8Array {
        const data = Project.serialize(project);
        return encodeJSON(data, true);
    }
}
