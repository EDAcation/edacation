import {decodeJSON, encodeJSON} from '../util.js';

import {DEFAULT_CONFIGURATION, type ProjectConfiguration, schemaProjectConfiguration} from './configuration.js';

type ProjectTarget = ProjectConfiguration['targets'][number];

export interface ProjectOutputFileState {
    path: string;
    targetId: string | null;
    stale: boolean;
}

export class ProjectOutputFile {
    constructor(
        private _project: Project,
        private _path: string,
        private _targetId: string | null = null,
        private _stale: boolean = false
    ) {}

    get path(): string {
        return this._path;
    }

    get targetId(): string | null {
        return this._targetId;
    }

    set targetId(id: string | null) {
        if (id !== null && this._project.getTarget(id) === null) {
            throw new Error(`Invalid target id: ${id}`);
        }
        this._targetId = id;
    }

    get target(): ProjectTarget | null {
        if (!this._targetId) return null;
        return this._project.getTarget(this._targetId);
    }

    get stale(): boolean {
        return this._stale;
    }

    static serialize(file: ProjectOutputFile): ProjectOutputFileState {
        return {
            path: file.path,
            targetId: file.targetId,
            stale: file.stale
        };
    }

    static deserialize(project: Project, data: ProjectOutputFileState | string, ..._args: unknown[]) {
        // Older versions of this module (<= 0.3.6) stored output files as an array of paths instead,
        // so we need to migrate if data is a string (single output file).
        if (typeof data === 'string') {
            data = {path: data, targetId: null, stale: false};
        }

        return new ProjectOutputFile(project, data.path, data.targetId, data.stale);
    }
}

export interface ProjectState {
    name: string;
    inputFiles: string[];
    outputFiles: ProjectOutputFileState[] | string[];
    configuration: ProjectConfiguration;
}

export class Project {
    private name: string;
    private inputFiles: string[];
    private outputFiles: ProjectOutputFile[];
    private configuration: ProjectConfiguration;

    constructor(
        name: string,
        inputFiles: string[] = [],
        outputFiles: ProjectOutputFileState[] | string[] = [],
        configuration: ProjectConfiguration = DEFAULT_CONFIGURATION
    ) {
        this.name = name;
        this.inputFiles = inputFiles;
        this.outputFiles = outputFiles.map((file: ProjectOutputFileState | string) =>
            ProjectOutputFile.deserialize(this, file)
        );

        const config = schemaProjectConfiguration.safeParse(configuration);
        if (config.success) {
            this.configuration = config.data;
        } else {
            throw new Error(`Failed to parse project configuration: ${config.error.toString()}`);
        }
    }

    getName() {
        return this.name;
    }

    getInputFiles() {
        return this.inputFiles;
    }

    hasInputFile(filePath: string) {
        return this.inputFiles.some((file) => file === filePath);
    }

    addInputFiles(filePaths: string[]) {
        for (const filePath of filePaths) {
            if (!this.hasInputFile(filePath)) {
                this.inputFiles.push(filePath);
            }
        }

        this.inputFiles.sort((a, b) => {
            return a < b ? -1 : 1;
        });
    }

    removeInputFiles(filePaths: string[]) {
        this.inputFiles = this.inputFiles.filter((file) => !filePaths.includes(file));
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
            if (this.hasOutputFile(file.path)) continue;

            const outputFile = new ProjectOutputFile(this, file.path, file.targetId);
            if (outputFile.target === null) throw new Error(`Invalid target ID: ${file.targetId}`);
            this.outputFiles.push(outputFile);
        }

        this.outputFiles.sort((a, b) => {
            return a < b ? -1 : 1;
        });
    }

    removeOutputFiles(filePaths: string[]) {
        this.outputFiles = this.outputFiles.filter((file) => !filePaths.includes(file.path));
    }

    getConfiguration() {
        return this.configuration;
    }

    updateConfiguration(configuration: Partial<ProjectConfiguration>) {
        this.configuration = {
            ...this.configuration,
            ...configuration
        };
    }

    getTarget(id: string): ProjectTarget | null {
        const targets = this.configuration.targets;
        return targets.find((target) => target.id === id) ?? null;
    }

    static serialize(project: Project): ProjectState {
        return {
            name: project.name,
            inputFiles: project.inputFiles,
            outputFiles: project.outputFiles.map((file) => ProjectOutputFile.serialize(file)),
            configuration: project.configuration
        };
    }

    static deserialize(data: ProjectState, ..._args: unknown[]): Project {
        const name: string = data.name;
        const inputFiles: string[] = data.inputFiles ?? [];
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
