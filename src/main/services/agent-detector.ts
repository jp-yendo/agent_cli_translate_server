import { execFile } from 'child_process';
import fs from 'fs';
import { AGENT_CLI_DEFINITIONS } from '../../shared/agent-catalog';
import type { AgentCliAvailability } from '../../shared/types';

// PATH 上から Agent CLI コマンドを検出する

// Volta のシム (.cmd) は "volta run <cmd>" を呼ぶだけで実体を特定できないため、
// "volta which" でインストール実体のパスへ解決する
function resolveVoltaShim(command: string, resolvedPath: string): Promise<string> {
    return new Promise(resolve => {
        let content = '';
        try {
            content = fs.readFileSync(resolvedPath, 'utf-8');
        } catch {
            resolve(resolvedPath);
            return;
        }
        if (!/volta\s+run/i.test(content)) {
            resolve(resolvedPath);
            return;
        }
        execFile('volta', ['which', command], { windowsHide: true }, (error, stdout) => {
            if (error) {
                resolve(resolvedPath);
                return;
            }
            const target = stdout.trim();
            if (!target) {
                resolve(resolvedPath);
                return;
            }
            // 拡張子なしの sh シムが返る場合は同じ場所の .cmd (npm cmd-shim) を優先する
            if (fs.existsSync(`${target}.cmd`)) {
                resolve(`${target}.cmd`);
                return;
            }
            resolve(fs.existsSync(target) ? target : resolvedPath);
        });
    });
}

function lookupCommand(command: string): Promise<string | null> {
    return new Promise(resolve => {
        const isWindows = process.platform === 'win32';
        const finder = isWindows ? 'where' : 'which';
        execFile(finder, [command], { windowsHide: true }, (error, stdout) => {
            if (error) {
                resolve(null);
                return;
            }
            const lines = stdout
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean);
            if (lines.length === 0) {
                resolve(null);
                return;
            }
            if (isWindows) {
                // where は PATHEXT の解決順と無関係に列挙するため、実行可能な拡張子を優先する
                const preferred =
                    lines.find(line => /\.(exe|cmd|bat)$/i.test(line)) ??
                    lines.find(line => /\.ps1$/i.test(line) === false) ??
                    lines[0];
                resolve(preferred);
                return;
            }
            resolve(lines[0]);
        });
    });
}

export async function detectAgents(): Promise<AgentCliAvailability[]> {
    const results = await Promise.all(
        AGENT_CLI_DEFINITIONS.map(async def => {
            let resolvedPath = await lookupCommand(def.command);
            if (resolvedPath && process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolvedPath)) {
                resolvedPath = await resolveVoltaShim(def.command, resolvedPath);
            }
            const availability: AgentCliAvailability = {
                id: def.id,
                displayName: def.displayName,
                command: def.command,
                packageName: def.packageName,
                available: resolvedPath !== null,
            };
            if (resolvedPath) {
                availability.resolvedPath = resolvedPath;
            }
            return availability;
        })
    );
    return results;
}
