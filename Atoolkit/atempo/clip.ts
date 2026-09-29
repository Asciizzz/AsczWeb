import { Track } from "./track.js";

export interface ClipMarker {
    time: number;
    label: string;
    data?: any;
}

/**
 * Parallel track orchestrator.
 * Evaluates multiple named tracks at common timestamp and tracks timeline marker crossings.
 */
export class Clip {
    readonly name: string;
    private _tracks: Map<string, Track<any, any>> = new Map();
    private _markers: ClipMarker[] = [];

    constructor(name = "UntitledClip") {
        this.name = name;
    }

    addTrack<TTrack extends Track<any, any>>(name: string, track: TTrack): TTrack {
        this._tracks.set(name, track);
        return track;
    }

    getTrack<TTrack extends Track<any, any>>(name: string): TTrack | undefined {
        return this._tracks.get(name) as TTrack | undefined;
    }

    removeTrack(name: string): boolean {
        return this._tracks.delete(name);
    }

    hasTrack(name: string): boolean {
        return this._tracks.has(name);
    }

    get trackNames(): string[] {
        return Array.from(this._tracks.keys());
    }

    get duration(): number {
        let maxDur = 0;
        for (const track of this._tracks.values()) {
            if (track.count > 0) {
                const d = track.duration;
                if (d > maxDur) maxDur = d;
            }
        }
        return maxDur;
    }

    get startTime(): number {
        let minStart = Infinity;
        for (const track of this._tracks.values()) {
            if (track.count > 0) {
                const s = track.startTime;
                if (s < minStart) minStart = s;
            }
        }
        return minStart === Infinity ? 0 : minStart;
    }

    get endTime(): number {
        let maxEnd = -Infinity;
        for (const track of this._tracks.values()) {
            if (track.count > 0) {
                const e = track.endTime;
                if (e > maxEnd) maxEnd = e;
            }
        }
        return maxEnd === -Infinity ? 0 : maxEnd;
    }

    addMarker(time: number, label: string, data?: any): this {
        this._markers.push({ time, label, data });
        this._markers.sort((a, b) => a.time - b.time);
        return this;
    }

    get markers(): ReadonlyArray<ClipMarker> {
        return this._markers;
    }

    getMarkersInRange(start: number, end: number, out?: ClipMarker[]): ClipMarker[] {
        const result = out ?? [];
        result.length = 0;
        const len = this._markers.length;
        for (let i = 0; i < len; i++) {
            const m = this._markers[i];
            if (m.time >= start && m.time <= end) {
                result.push(m);
            }
        }
        return result;
    }

    /**
     * Identifies markers crossed between previousTime and currentTime.
     * Supports forward and reverse timeline traversal.
     */
    sampleCrossedMarkers(previousTime: number, currentTime: number, out?: ClipMarker[]): ClipMarker[] {
        const result = out ?? [];
        result.length = 0;
        const len = this._markers.length;
        if (currentTime >= previousTime) {
            for (let i = 0; i < len; i++) {
                const m = this._markers[i];
                if (m.time > previousTime && m.time <= currentTime) {
                    result.push(m);
                }
            }
        } else {
            for (let i = 0; i < len; i++) {
                const m = this._markers[i];
                if (m.time < previousTime && m.time >= currentTime) {
                    result.push(m);
                }
            }
        }
        return result;
    }

    /**
     * Evaluates all registered tracks at time, writing values to target map.
     */
    sample(time: number, target: Record<string, any> = {}): Record<string, any> {
        for (const [name, track] of this._tracks.entries()) {
            target[name] = track.sample(time, target[name]);
        }
        return target;
    }
}
