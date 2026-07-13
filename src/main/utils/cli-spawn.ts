import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Agent CLI プロセスの起動方法を解決するユーティリティ
//
// Windows では npm のグローバルインストールが .cmd シムを生成するが、
// .cmd を経由すると cmd.exe の制約で改行を含む引数を渡せない。
// そのためシムから実体の JS エントリを解決し、Node.js で直接実行する。
//
// JS エントリの実行には可能な限り node.exe を使う。node.exe はコンソール
// アプリケーションのため、windowsHide (CREATE_NO_WINDOW) で作られた非表示
// コンソールを子孫プロセスが継承し、CLI が内部で起動するネイティブ実行
// ファイルもウィンドウを表示しない。GUI アプリである Electron を
// ELECTRON_RUN_AS_NODE=1 で使うとコンソールが存在せず、子孫のコンソール
// プロセスが新しい可視ウィンドウを割り当ててしまうため、最終手段とする。

export type CliLaunchPlan = {
    file: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    // .cmd/.bat をそのまま起動する場合のみ true (引数に任意テキストを含めてはならない)
    useShell: boolean;
};

// PATH 上の node.exe (キャッシュ)。undefined は未探索、null は見つからなかったことを表す
let cachedNodePath: string | null | undefined;

function findNodeExecutable(shimDir: string | null): string | null {
    // npm のグローバルインストールではシムと同じディレクトリに node.exe が置かれている
    if (shimDir) {
        const local = path.join(shimDir, 'node.exe');
        if (fs.existsSync(local)) {
            return local;
        }
    }
    if (cachedNodePath === undefined) {
        try {
            const output = execFileSync('where', ['node'], { encoding: 'utf-8', windowsHide: true });
            cachedNodePath =
                output
                    .split(/\r?\n/)
                    .map(line => line.trim())
                    .find(line => /\.exe$/i.test(line)) ?? null;
        } catch {
            cachedNodePath = null;
        }
    }
    return cachedNodePath;
}

// JS エントリを Node.js として実行する起動計画を作る
function buildNodeLaunchPlan(
    scriptPath: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    shimDir: string | null
): CliLaunchPlan {
    const nodePath = findNodeExecutable(shimDir);
    if (nodePath) {
        return { file: nodePath, args: [scriptPath, ...args], env, useShell: false };
    }
    // node.exe が見つからない場合のみ Electron を Node.js として利用する
    env.ELECTRON_RUN_AS_NODE = '1';
    return { file: process.execPath, args: [scriptPath, ...args], env, useShell: false };
}

// npm/yarn/pnpm の cmd-shim から実行対象の JS ファイルパスを取り出す
function resolveCmdShimTarget(cmdPath: string): string | null {
    let content: string;
    try {
        content = fs.readFileSync(cmdPath, 'utf-8');
    } catch {
        return null;
    }
    const shimDir = path.dirname(cmdPath);
    // 例: "%_prog%"  "%dp0%\node_modules\@anthropic-ai\claude-code\cli.js" %*
    const patterns = [/"%(?:~)?dp0%?\\([^"]+)"\s+%\*/g, /"%dp0%\\([^"]+)"/g];
    for (const pattern of patterns) {
        for (const match of content.matchAll(pattern)) {
            const relative = match[1];
            if (/node(?:\.exe)?$/i.test(relative)) continue;
            const target = path.resolve(shimDir, relative);
            if (fs.existsSync(target)) {
                return target;
            }
        }
    }
    return null;
}

export function buildCliLaunchPlan(resolvedPath: string, args: string[]): CliLaunchPlan {
    const env: NodeJS.ProcessEnv = { ...process.env };

    if (process.platform !== 'win32') {
        return { file: resolvedPath, args, env, useShell: false };
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    if (ext === '.exe' || ext === '.com') {
        return { file: resolvedPath, args, env, useShell: false };
    }

    if (ext === '.cmd' || ext === '.bat') {
        const target = resolveCmdShimTarget(resolvedPath);
        if (target && !/\.(exe|com)$/i.test(target)) {
            return buildNodeLaunchPlan(target, args, env, path.dirname(resolvedPath));
        }
        if (target) {
            return { file: target, args, env, useShell: false };
        }
        // シム解決に失敗した場合は cmd.exe 経由で起動する
        // (この場合、引数へ改行等を含むテキストを渡すことはできない)
        return { file: resolvedPath, args, env, useShell: true };
    }

    // 拡張子なしのファイルは shebang を確認し、Node.js スクリプトなら node として実行する
    try {
        const firstLine = fs.readFileSync(resolvedPath, 'utf-8').split(/\r?\n/, 1)[0] ?? '';
        if (firstLine.includes('node')) {
            return buildNodeLaunchPlan(resolvedPath, args, env, null);
        }
    } catch {
        // 読み取り失敗時はそのまま直接起動を試みる
    }
    return { file: resolvedPath, args, env, useShell: false };
}
