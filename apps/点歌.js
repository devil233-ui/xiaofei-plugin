import fs from 'fs';
import md5 from 'md5';
import crypto from 'crypto';
import fetch from "node-fetch";
import { Config, Data, Version, Plugin_Path } from '../components/index.js';
import uploadRecord from '../model/uploadRecord.js';

let toSilk
try { toSilk = (await import('../model/toSilk.js')).default; } catch { };
const no_pic = '';
var _page_size = 20;
var _music_timeout = 1000 * 60 * 3;

const SOURCE_NAME_MAP = {
    qq: 'QQ音乐',
    netease: '网易云音乐',
    kuwo: '酷我音乐',
    kugou: '酷狗音乐',
    bilibili: '哔哩哔哩',
    migu: '咪咕音乐'
};

const music_source = {
    '哔哩哔哩': 'bilibili',
    '哔哩': 'bilibili',
    '网易云': 'netease',
    '网易': 'netease',
    '酷我': 'kuwo',
    '酷狗': 'kugou',
    'QQ': 'qq',
    'qq': 'qq'
};

var music_cookies = {
    bilibili: {
        get ck() {
            try {
                let data = Config.getConfig('music', 'cookies');
                if (data?.bilibili) return data?.bilibili;
            } catch (err) { }
            return '';
        },
        set ck(cookies) {
            try {
                let data = Config.getConfig('music', 'cookies');
                data = data ? data : {};
                data.bilibili = cookies;
                Config.saveConfig('music', 'cookies', data);
            } catch (err) { logger.error(err); }
        }
    },
    qqmusic: {
        get ck() {
            try {
                let data = Config.getConfig('music', 'cookies');
                if (data?.qqmusic) return getCookieMap(data?.qqmusic);
            } catch (err) { }
            return null;
        },
        set ck(cookies) {
            try {
                if (typeof (cookies) == 'object') {
                    try {
                        let cks = [];
                        for (let key of cookies.keys()) {
                            let value = cookies.get(key);
                            if (value) cks.push(`${key}=${value}`);
                        }
                        cookies = cks.join('; ');
                    } catch (err) { }
                }
                let data = Config.getConfig('music', 'cookies');
                data = data ? data : {};
                data.qqmusic = cookies;
                Config.saveConfig('music', 'cookies', data);
            } catch (err) { logger.error(err); }
        },
        body: {
            comm: {
                "_channelid": "19",
                "_os_version": "6.2.9200-2",
                "authst": "",
                "ct": "19",
                "cv": "1891",
                "guid": md5(String(Bot?.uin || '000000') + 'music'),
                "patch": "118",
                "psrf_access_token_expiresAt": 0,
                "psrf_qqaccess_token": "",
                "psrf_qqopenid": "",
                "psrf_qqunionid": "",
                "tmeAppID": "qqmusic",
                "tmeLoginType": 2,
                "uin": "0",
                "wid": "0"
            }
        },
        init: false,
        update_time: 0
    },
    netease: {
        get ck() {
            try {
                let data = Config.getConfig('music', 'cookies');
                if (data?.netease) return data?.netease;
            } catch (err) { }
            return '';
        },
        set ck(cookies) {
            try {
                let data = Config.getConfig('music', 'cookies');
                data = data ? data : {};
                data.netease = cookies;
                Config.saveConfig('music', 'cookies', data);
            } catch (err) { logger.error(err); }
        }
    }
};

const music_reg = '^#?(小飞)?(' + Object.keys(music_source).join('|') + '|多选)?(' + Object.keys(music_source).join('|') + '|多选)?(点播音乐|点播|点歌|播放|放一?首|来一?首|下一页|个性电台|每日推荐|每日30首|日推|我的收藏|我喜欢的歌)(.*)$';

export class xiaofei_music extends plugin {
    constructor() {
        super({
            name: '小飞插件_点歌',
            dsc: '',
            event: 'message',
            priority: 2000,
            rule: [
                { reg: '^#?(点歌|音乐)(ck|cookie)(检查|状态)$', fnc: 'music_ck_check', permission: 'master' },
                { reg: '^#?提交(音乐|点歌)ck.*$', fnc: 'submit_music_ck', permission: 'master' },
                { reg: music_reg, fnc: 'music' }
            ]
        });
        try {
            let setting = Config.getdefSet('setting', 'system') || {};
            this.priority = setting['music'] == true ? 10 : 2000;
        } catch (err) { }
        this.task = [{ cron: '*/10 * * * * ?', name: '[小飞插件_点歌]默认任务', fnc: this.music_task, log: false }];
    }

    init() {
        new Promise(async (resolve, reject) => {
            try {
                for (let key in music_cookies) {
                    let ck = music_cookies[key].ck;
                    if (key == 'netease' && (!ck || ck?.includes('MUSIC_U=;'))) {
                        logger.info(`【小飞插件_网易云音乐ck】未设置网易云音乐ck！`);
                    }
                }
                await update_qqmusic_ck();
            } catch (err) { }

            try {
                let path = `${process.cwd()}/data/html/xiaofei-plugin/music_list`;
                if (!fs.existsSync(path)) return;
                let files = fs.readdirSync(path);
                files.forEach(file => { fs.unlink(`${path}/${file}`, err => { }); });
            } catch (err) { }
            resolve();
        });
    }

    async music_task(e) {
        let data = xiaofei_plugin.music_temp_data;
        for (let key in data) {
            if ((new Date().getTime() - data[key].time) > _music_timeout) {
                let temp = data[key];
                delete data[key];
                // await recallMusicMsg(e, key, temp.msg_results);
            }
        }
        try { await update_qqmusic_ck(); } catch (err) { logger.error(err); }
    }

    async music() { return music_message(this.e); }

    accept() {
        if (/^#?(小飞语音|小飞高清语音|小飞歌词|语音|高清语音|歌词|下载音乐)?(\d+)?$/.test(this.e.msg)) {
            music_message(this.e);
        }
        return;
    }

    async music_ck_check(e) {
        let msgs = [];
        let list = [
            { name: '哔哩哔哩', ck: (music_cookies.bilibili.ck && music_cookies.bilibili.ck.includes('SESSDATA')), cookies: music_cookies.bilibili.ck, user_info: get_bilibili_userinfo },
            { name: 'QQ音乐', ck: (music_cookies.qqmusic.ck && music_cookies.qqmusic.ck.get('qqmusic_key')), cookies: music_cookies.qqmusic.ck, user_info: get_qqmusic_userinfo },
            { name: '网易云音乐', ck: !music_cookies.netease.ck?.includes('MUSIC_U=;'), cookies: music_cookies.netease.ck, user_info: get_netease_userinfo }
        ];

        for (let val of list) {
            msgs.push(`---${val.name}---`);
            if (!val.ck) {
                msgs.push(`状态：未设置ck`);
            } else {
                let result = await val.user_info(val.cookies);
                if (result.code == 1) {
                    let data = result.data;
                    let userid = String(data.userid);
                    if (e.isGroup) userid = userid.length > 5 ? `${userid.substring(0, 3)}***${userid.substring(userid.length - 3)}` : `${userid.substring(0, 1)}**${userid.substring(userid.length - 1)}`;
                    msgs.push(`账号：${data.nickname}[${userid}]`);
                    msgs.push(`状态：ck状态正常`);
                    msgs.push(`是否VIP：${data.is_vip ? '是' : '否'}`);
                } else {
                    msgs.push(`状态：ck已失效`);
                }
            }
        }
        let forwardMsg = await Bot.makeForwardMsg([{ nickname: e.bot?.nickname || Bot?.nickname, user_id: e.bot?.uin || e?.self_id || Bot.uin, message: `---音乐ck状态---\n${msgs.join('\n')}` }]);
        await e.reply(forwardMsg);
        return true;
    }

    async submit_music_ck(e) {
        let reg = /^#?提交(音乐|点歌)ck(.*)$/.exec(e.msg);
        if (reg) {
            let cookies;
            try {
                let raw_ck = reg[2].trim();
                if ((raw_ck.startsWith('"') && raw_ck.endsWith('"')) || (raw_ck.startsWith("'") && raw_ck.endsWith("'"))) {
                    raw_ck = raw_ck.slice(1, -1);
                }
                if (raw_ck.includes('SESSDATA=')) {
                    music_cookies.bilibili.ck = raw_ck;
                    await e.reply(`哔哩哔哩ck提交成功！\n搜歌时将优先使用此账号权限（可搜索被限流视频）。`);
                    return true;
                }
                cookies = getCookieMap(raw_ck);
                if (cookies.get('MUSIC_U')) {
                    let netease_cookies = `MUSIC_U=${cookies.get('MUSIC_U')};`;
                    let result = await get_netease_userinfo(netease_cookies);
                    if (result.code != 1) {
                        await e.reply(`网易云音乐ck不正确或已失效，请重新获取！`);
                        return true;
                    }
                    music_cookies.netease.ck = netease_cookies;
                    let data = result.data;
                    await e.reply(`网易云音乐ck提交成功！\n账号：${data.nickname}[${data.userid}]\n是否VIP：${data.is_vip ? '是' : '否'}`);
                    return true;
                } else if (cookies.get('wxunionid') || cookies.get('psrf_qqunionid')) {
                    let result = await get_qqmusic_userinfo(cookies);
                    if (result.code != 1) {
                        await e.reply(`QQ音乐ck不正确或已失效，请重新获取！`);
                        return true;
                    }
                    cookies.set('psrf_musickey_createtime', 0);
                    music_cookies.qqmusic.ck = cookies;
                    music_cookies.qqmusic.update_time = 0;
                    try { update_qqmusic_ck(); } catch (err) { }
                    let data = result.data;
                    await e.reply(`QQ音乐ck提交成功！\n账号：${data.nickname}[${data.userid}]\n是否VIP：${data.is_vip ? '是' : '否'}`);
                    return true;
                }
            } catch (err) {
                await e.reply(`ck解析出错，请检查输入是否正确！`);
            }
        }
        let MsgList = [];
        let user_info = { nickname: e.bot?.nickname || Bot?.nickname, user_id: e.bot?.uin || e.self_id || Bot.uin };
        let msgs = ['格式：提交音乐ck+音乐ck'];
        msgs.push(`---哔哩哔哩ck说明---`);
        msgs.push(`请前往：https://www.bilibili.com/ 登录后获取`);
        msgs.push(`必须参数：SESSDATA=xxx;`);
        msgs.push(`获取方法：浏览器按F12 -> 应用(Application) -> Cookies -> 找到 SESSDATA 复制整段。`);
        msgs.push(`---QQ音乐ck说明---`);
        msgs.push(`请前往：http://y.qq.com/ 获取以下ck：`);
        msgs.push(`QQ登录必须参数：uin=; psrf_qqopenid=; psrf_qqunionid=; psrf_qqrefresh_token=; qm_keyst=; qqmusic_key=;`);
        msgs.push(`---网易云音乐ck说明---`);
        msgs.push(`请前往：http://music.163.com/ 获取以下ck：`);
        msgs.push(`必须参数：MUSIC_U=;`);
        MsgList.push({ ...user_info, message: `---提交音乐ck说明---\n${msgs.join('\n')}` });
        let forwardMsg = await Bot.makeForwardMsg(MsgList);
        await e.reply(forwardMsg);
        return true;
    }
}

// ====================== 工具函数区 ======================
function get_qqmusic_id(text) {
    if (/^\d+$/.test(text)) return text;
    let match = /id=(\d+)/.exec(text);
    if (match) return match[1];
    return null;
}

function get_netease_id(text) {
    let match = /id=(\d+)/.exec(text);
    if (match) return match[1];
    match = /playlist\/(\d+)/.exec(text);
    if (match) return match[1];
    if (/^\d+$/.test(text)) return text;
    return null;
}

async function netease_get_playlist(id, page = 1, page_size = 10) {
    try {
        let url = `https://music.163.com/api/v1/playlist/detail?id=${id}`;
        let options = {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Cookie': music_cookies.netease?.ck || ''
            }
        };
        let response = await fetch(url, options);
        let res = await response.json();
        if (res.code == 200 && res.playlist && res.playlist.tracks) {
            let tracks = res.playlist.tracks;
            let start = (page - 1) * page_size;
            let sliced_tracks = tracks.slice(start, start + page_size);
            return {
                title: res.playlist.name,
                author: res.playlist.creator?.nickname || '未知',
                desc: res.playlist.description || '',
                page: page,
                data: sliced_tracks
            };
        }
    } catch (err) {
        logger.error(`[小飞点歌] 网易云歌单获取失败: ${err}`);
    }
    return null;
}

async function recallMusicMsg(e, key, msg_results) {
    if (msg_results && msg_results.length > 0) {
        for (let msg_result of msg_results) {
            let arr = key?.split('_');
            let type = arr[0];
            for (let val of msg_result) {
                try {
                    val = await val;
                    let message_id = (await val?.message)?.message_id || val?.message_id;
                    switch (type) {
                        case 'group': await (e?.bot || Bot?.[arr[3]] || Bot)?.pickGroup(arr[1]).recallMsg(message_id); break;
                        case 'friend': await (e?.bot || Bot?.[arr[2]] || Bot)?.pickFriend(arr[1]).recallMsg(message_id); break;
                    }
                } catch (err) { logger.error(err); }
            }
        }
    }
}

if (!xiaofei_plugin.music_temp_data) xiaofei_plugin.music_temp_data = {};
if (!xiaofei_plugin.music_poke_cd) xiaofei_plugin.music_poke_cd = {};

if (xiaofei_plugin.music_guild) Bot.off('guild.message', xiaofei_plugin.music_guild);
xiaofei_plugin.music_guild = async (e) => {
    e.msg = e.raw_message;
    if (RegExp(music_reg).test(e.msg) || /^#?(小飞语音|小飞高清语音|小飞歌词|语音|高清语音|歌词|下载音乐)?(\d+)?$/.test(e.msg)) {
        music_message(e);
    }
};
Bot.on('guild.message', xiaofei_plugin.music_guild);

if (xiaofei_plugin.music_notice) Bot.off('notice', xiaofei_plugin.music_notice);
xiaofei_plugin.music_notice = async (e) => {
    if (e?.sub_type != 'poke' || e?.target_id != e?.self_id) return;
    e.user_id = e?.operator_id;
    let key = get_MusicListId(e);
    let time = xiaofei_plugin.music_poke_cd[key] || 0;
    if ((new Date().getTime() - time) < 8000) return;
    xiaofei_plugin.music_poke_cd[key] = new Date().getTime();
    let setting = Config.getdefSet('setting', 'system') || {};
    if (setting['poke'] != true) return;
    e.msg = '#小飞来首歌';
    if (await music_message(e)) return;
}
Bot.on('notice', xiaofei_plugin.music_notice);

async function update_qqmusic_ck() {
    try {
        let update_time = music_cookies.qqmusic.update_time;
        if ((new Date().getTime() - update_time) < (1000 * 60 * 10)) return;
        music_cookies.qqmusic.update_time = new Date().getTime();
        let type = -1;
        let ck_map = music_cookies.qqmusic.ck || new Map();
        if (ck_map.get('wxunionid')) type = 1;
        else if (ck_map.get('psrf_qqunionid')) type = 0;
        else {
            if (!music_cookies.qqmusic.init) {
                music_cookies.qqmusic.init = true;
                logger.info(`【小飞插件_QQ音乐ck】未设置QQ音乐ck！`);
            }
            return;
        }
        let authst = ck_map.get('music_key') || ck_map.get('qm_keyst');
        let psrf_musickey_createtime = Number(ck_map.get("psrf_musickey_createtime") || 0) * 1000;
        let refresh_num = Number(ck_map.get("refresh_num") || 0);
        if (((new Date().getTime() - psrf_musickey_createtime) > (1000 * 60 * 60 * 12) || !authst) && refresh_num < 3) {
            music_cookies.qqmusic.body.comm.guid = md5(String(ck_map.get('uin') || ck_map.get('wxuin')) + 'music');
            let result = await qqmusic_refresh_token(ck_map, type);
            if (result.code == 1) {
                ck_map = result.data;
                logger.info(`【小飞插件_QQ音乐ck】已刷新！`);
            } else {
                ck_map.set("refresh_num", refresh_num + 1);
                music_cookies.qqmusic.init = false;
                logger.error(`【小飞插件_QQ音乐ck】刷新失败！`);
            }
            music_cookies.qqmusic.ck = ck_map;
            authst = ck_map.get('qqmusic_key') || ck_map.get('qm_keyst');
        } else if (refresh_num > 2) {
            if (!music_cookies.qqmusic.init) {
                music_cookies.qqmusic.init = true;
                logger.error(`【小飞插件_QQ音乐ck】ck已失效！`);
            }
        }
        let comm = music_cookies.qqmusic.body.comm;
        if (type == 0) comm.uin = ck_map.get('uin') || '', comm.psrf_qqunionid = ck_map.get('psrf_qqunionid') || '';
        if (type == 1) comm.wid = ck_map.get('wxuin') || '', comm.psrf_qqunionid = ck_map.get('wxunionid') || '';
        comm.tmeLoginType = Number(ck_map.get('tmeLoginType') || '2');
        comm.authst = authst || '';
    } catch (err) { logger.error(err); }
}

async function music_message(e) {
    let reg = /^#?(小飞语音|小飞高清语音|小飞歌词|语音|高清语音|歌词|下载音乐)?(\d+)?$/.exec(e.msg);
    if (reg) {
        if (e.source && (reg[1]?.includes('语音') || reg[1]?.includes('下载音乐'))) {
            let source;
            if (e.isGroup) source = (await e.group.getChatHistory(e.source.seq, 1)).pop();
            else source = (await e.friend.getChatHistory(e.source.time, 1)).pop();

            if (source && source['message'][0]['type'] == 'json') {
                try {
                    let music_json = JSON.parse(source['message'][0]['data']);
                    if (music_json['view'] == 'music') {
                        let music = music_json.meta.music;
                        
                        // 【分离逻辑】先发链接（不撤回），再发提示（撤回）
                        await e.reply(`收听链接提取：\n${music.musicUrl}`);
                        await e.reply(`处理上传中，这可能需要一点时间...\n[${music.title}]`, true, { recallMsg: 45 });
                        
                        let result, isHigh;
                        try {
                            result = await uploadRecord(e, music.musicUrl, 0, !reg[1].includes('高清'), music.title + '-' + music.desc);
                            isHigh = true
                        } catch (error) {
                            logger.error(`[小飞点歌] uploadRecord 异常: ${error}`);
                            try {
                                result = await segment.record(await toSilk(music.musicUrl) || music.musicUrl);
                                isHigh = false
                            } catch (fallbackErr) {}
                        }
                        
                        if (!result) {
                            await e.reply(`⚠️ 上传[${music.title}]失败！请直接使用上方的链接。`);
                            return true;
                        }
                        
                        try {
                            result = await e.reply(result);
                        } catch (replyErr) {
                            logger.error(`[小飞点歌] 最终发送超时: ${replyErr}`);
                            await e.reply(`⚠️ 发送[${music.title}]语音超时或失败！请直接点上方的链接收听。`);
                            return true;
                        }
                        
                        if (reg[1].includes('高清') && result && isHigh) {
                            try {
                                let message = await (Bot || e.bot || e.group || e.friend)?.getMsg(result.message_id);
                                if (Array.isArray(message.message)) message.message.push({ type: 'text', text: '[语音]' });
                                await (e.group || e.friend)?.sendMsg('PCQQ不要播放，否则会导致语音无声音！', message);
                            } catch (err) {
                                let message = [await segment.reply(result.message_id), `PCQQ不要播放，否则会导致语音无声音！`];
                                await (e.group || e.friend)?.sendMsg(message);
                            }
                        }
                    }
                } catch (err) { }
                return true;
            }
        }

        let key = get_MusicListId(e);
        let data = xiaofei_plugin.music_temp_data[key];
        if (!data || (new Date().getTime() - data.time) > _music_timeout) return false;

        if ((reg[1]?.includes('语音') || reg[1]?.includes('歌词') || reg[1]?.includes('下载音乐')) && !reg[2]) {
            reg[2] = String((data.index + 1) + data.start_index);
        }
        let index = (Number(reg[2]) - 1) - data.start_index;

        if (data.data.length > index && index > -1) {
            if (data.data.length < 2 && !reg[1]?.includes('语音') && !reg[1]?.includes('歌词') && !reg[1]?.includes('下载音乐')) return false;
            data.index = index;
            let music = data.data[index];

            if (!reg[1]?.includes('歌词')) {
                let music_json = await CreateMusicShareJSON(music);
                if (reg[1] && (reg[1].includes('语音') || reg[1]?.includes('下载音乐'))) {
                    if (!music_json.meta.music || !music_json.meta.music?.musicUrl) {
                        await e.reply(`[${music.name}-${music.artist}] 获取下载地址失败！`);
                        return true;
                    }
                    
                    // 【分离逻辑】先发链接（不撤回），再发提示（撤回）
                    await e.reply(`已提取[${music.name}]链接：\n${music_json.meta.music.musicUrl}`);
                    await e.reply(`开始转换[${music.name}-${music.artist}]，较大文件可能需等待1-3分钟...`, true, { recallMsg: 45 });
                    
                    let result, isHigh;
                    try {
                        result = await uploadRecord(e, music_json.meta.music.musicUrl, 0, !reg[1].includes('高清'), music.name + '-' + music.artist);
                        isHigh = true;
                    } catch (error) {
                        logger.error(error);
                        try {
                            result = await segment.record(await toSilk(music_json.meta.music.musicUrl) || music_json.meta.music.musicUrl);
                            isHigh = false;
                        } catch (fallbackErr) {}
                    }
                    
                    if (!result) {
                        await e.reply(`⚠️ 转换[${music.name}]失败！请直接点击上方链接收听。`);
                        return true;
                    }
                    
                    try {
                        result = await e.reply(result);
                    } catch (replyErr) {
                        logger.error(`[小飞点歌] 发送超时: ${replyErr}`);
                        await e.reply(`⚠️ 发送[${music.name}]语音超时！文件过大，请点击上方链接收听。`);
                        return true;
                    }
                    
                    if (reg[1].includes('高清') && result && isHigh) {
                        let message = [await segment.reply(result.message_id), `PCQQ不要播放，否则会导致语音无声音！`];
                        await (e.group || e.friend)?.sendMsg(message);
                    }
                    return true;
                }
                let body = await CreateMusicShare(e, music);
                await SendMusicShare(e, body, music);
            } else {
                try {
                    typeof (music.lrc) == 'function' ? music.lrc = await music.lrc(music.data) : music.lrc = music.lrc;
                    if (music.lrc == null && typeof (music.api) == 'function') await music.api(music.data, ['lrc'], music);
                } catch (err) { }
                let lrcs = music.lrc || '没有查询到这首歌的歌词！';
                if (!Array.isArray(lrcs)) lrcs = [lrcs];
                let user_info = { nickname: e.bot?.nickname || Bot?.nickname, user_id: e.bot?.uin || e?.self_id || Bot.uin };
                let MsgList = [];
                for (let lrc of lrcs) {
                    let lrc_text = [], lrc_reg = /\[.*\](.*)?/gm, exec;
                    while (exec = lrc_reg.exec(lrc)) { if (exec[1]) lrc_text.push(exec[1]); }
                    if (lrc_text.length > 0) MsgList.push({ ...user_info, message: `---${music.name}-${music.artist}---\n${lrc_text.join('\n')}` });
                    MsgList.push({ ...user_info, message: `---${music.name}-${music.artist}---\n${lrc}` });
                }
                let forwardMsg = await Bot.makeForwardMsg(MsgList);
                await e.reply(forwardMsg);
            }
            return true;
        }
        return false;
    }

    reg = RegExp(music_reg).exec(e.msg);
    let search = reg[5];
    let source = '';
    if (!reg[2]) reg[2] = '';
    if (!reg[3]) reg[3] = '';
    if (music_source[reg[2]]) { let source = reg[2]; reg[2] = reg[3]; reg[3] = source; }
    let setting = Config.getdefSet('setting', 'system') || {};
    source = music_source[reg[3]] || (music_source[setting['music_source']] || 'qq');
    try {
        let arr = Object.entries(music_source);
        let index = Object.values(music_source).indexOf(source);
        reg[3] = arr[index][0] || reg[3];
    } catch (err) { }
    source = [source, reg[3]];
    if (search == '' && reg[4] != '下一页' && reg[4] != '个性电台' && reg[4] != '每日推荐' && reg[4] != '每日30首' && reg[4] != '日推' && !((reg[4] == '来首' || reg[4] == '放首') && search == '歌') && reg[4] != '我的收藏' && reg[4] != '我喜欢的歌') {
        let help = "------点歌说明------\r\n格式：#点歌 #多选点歌\r\n支持：QQ、网易、酷我、酷狗\r\n例如：#QQ点歌 #多选QQ点歌"
        await e.reply(help, true);
        return true;
    }
    if (setting['is_list'] == true) reg[2] = '多选';
    let temp_data = {};
    let page = reg[2] == '多选' ? 1 : 0;
    let page_size = reg[2] == '多选' ? _page_size : 10;
    if (((reg[4] == '来首' || reg[4] == '放首') && search == '歌')) { search = e.user_id; source = ['qq_recommend', '推荐']; page = 0; page_size = 1; }
    if (reg[4] == '个性电台') {
        if (reg[4] == '个性电台' && search != '') return true;
        search = e.user_id; source = ['qq_radio', '个性电台']; page = 0; page_size = 5;
        if (reg[4].includes('首')) page_size = 1; else e.reply('请稍候。。。', true);
    }
    if (reg[4] == '每日推荐' || reg[4] == '每日30首' || reg[4] == '日推') {
        if (search != '') return true;
        search = e.user_id; source = ['qq_DailyRecommend', '每日推荐']; page = 0; page_size = 30; e.reply('请稍候。。。', true);
    }
    if (reg[4] == '我的收藏' || reg[4] == '我喜欢的歌') {
        let page_reg = /^\d+$/.exec(search);
        if (search != '' && !page_reg) return true;
        search = e.user_id; source = ['qq_like', '收藏']; page = (!page_reg ? 1 : parseInt(page_reg[0])); page_size = page == 0 ? 30 : _page_size; e.reply('请稍候。。。', true);
    }
    if (reg[4] == '下一页') {
        let key = get_MusicListId(e);
        let data = xiaofei_plugin.music_temp_data[key];
        if (!data || (new Date().getTime() - data.time) > _music_timeout || data.page < 1) return false;
        data.time = new Date().getTime(); page_size = _page_size; page = data.page + 1; search = data.search; source = data.source; temp_data = data;
    }
    return music_handle(e, search, source, page, page_size, temp_data);
}

async function music_handle(e, search, source, page = 0, page_size = 10, temp_data = {}) {
    let result;
    let is_qq_source = (source[0] == 'qq' || source[0] == 'qq_playlist');
    let is_netease_source = (source[0] == 'netease');
    let is_playlist_mode = false; 
    let qq_id = get_qqmusic_id(search);
    if (qq_id && is_qq_source) {
        result = await qqmusic_getdiss(0, qq_id, 0, page == 0 ? 1 : page, page_size);
        if (result?.data?.length > 0) {
            source = ['qq', 'QQ歌单'];
            is_playlist_mode = true;
        }
    }
    if (!result) {
        let wy_id = get_netease_id(search);
        if (search.includes('163.com') || search.includes('music.163')) { is_netease_source = true; source = ['netease', '网易云音乐']; }
        if (wy_id && is_netease_source) {
            result = await netease_get_playlist(wy_id, page == 0 ? 1 : page, page_size);
            if (result?.data?.length > 0) { source = ['netease', '网易歌单']; is_playlist_mode = true; }
        }
    }
    if (!result) {
        result = await music_search(e, search, source[0], page == 0 ? 1 : page, page_size);
        if (result && result.source && result.source !== source[0]) {
            source = [result.source, SOURCE_NAME_MAP[result.source] || result.source];
        }
    }
    if (result && result.data && result.data.length > 0) {
        let key = get_MusicListId(e);
        let data = xiaofei_plugin.music_temp_data;
        let temp = data[key];
        if (temp?.msg_results && (temp?.search != search || temp?.source[0] != source[0] || page < 2 || !temp_data?.data)) {
            delete data[key];
            await recallMusicMsg(e, key, temp.msg_results);
        }
        data = {};
        if (page > 0 && result.data.length > 1) {
            page = result.page;
            if (is_playlist_mode && page === 1) {
                await e.reply(`正在为您加载歌单\n━━━━━━━━━━━━\n📄 歌单：${result.title}\n👤 作者：${result.author || '未知'}`);
            }
            let title = (is_playlist_mode) ? source[1] : (source[1] + '点歌列表');
            if (result.title) title = result.title;
            if (result.data.length >= page_size || page > 1) title += `[第${page}页]`;
            let msg_result = [];
            if (e.guild_id) msg_result.push(e.reply(ShareMusic_TextList(e, result.data, page, page_size, title)));
            else msg_result.push(new Promise(async (resolve) => { resolve(await e.reply(await ShareMusic_HtmlList(e, result.data, page, page_size, title))); }));
            if (page > 1) {
                let list_data = (temp_data.data || []).concat(result.data);
                let msg_results = (temp_data.msg_results || []).concat([msg_result]);
                data = { time: new Date().getTime(), data: list_data, page: result.page, msg_results: msg_results, search: search, source: source, index: -1, start_index: temp_data.start_index };
            } else {
                data = { time: new Date().getTime(), data: result.data, page: result.page, msg_results: [msg_result], search: search, source: source, index: -1, start_index: 0 };
            }
        } else {
            if (['qq_radio', 'qq_recommend', 'qq_like', 'qq_DailyRecommend'].includes(source[0])) {
                 let nickname = e.sender.nickname || e.user_id;
                 if (e.isGroup) {
                    try {
                        let info = await e.bot?.getGroupMemberInfo(e.group_id, e.user_id);
                        nickname = info?.card || info?.nickname;
                    } catch (err) {
                        let info = e.bot.pickMember(e.group_id, e.user_id);
                        nickname = info?.info?.card || info?.info?.nickname;
                    }
                }
                let MsgList = [];
                let index = 1;
                let tag = 'QQ音乐' + source[1];
                if (result.data.length > 1) {
                    if (result.desc) MsgList.push({ nickname, user_id: e.user_id, message: result.desc });
                    for (let music of result.data) {
                        let music_json = await CreateMusicShareJSON({ ...music });
                        music_json.meta.music.tag = index + '.' + tag;
                        MsgList.push({ nickname, user_id: e.user_id, message: Version.isTrss ? { type: "json", data: music_json } : segment.json(music_json) });
                        index++;
                    }
                    let forwardMsg = await Bot.makeForwardMsg(MsgList);
                    await e.reply(forwardMsg);
                    data = { time: new Date().getTime() + (1000 * 60 * 27), data: result.data, page: 0, msg_results: [], search: search, source: source, index: -1, start_index: 0 };
                } else {
                    let music = result.data[0];
                    await SendMusicShare(e, await CreateMusicShare(e, music), music);
                    data = { time: new Date().getTime(), data: [result.data[0]], page: 0, msg_results: [], search: search, source: source, index: 0, start_index: 0 };
                }
            } else {
                let music = result.data[0];
                data = { time: new Date().getTime(), data: [music], page: 0, msg_results: [], search: search, source: source, index: 0, start_index: 0 };
                await SendMusicShare(e, await CreateMusicShare(e, music), music);
            }
        }
        xiaofei_plugin.music_temp_data[get_MusicListId(e)] = data;
    } else {
        await e.reply(page > 1 ? '⚠️ 没有找到更多歌曲！' : '⚠️ 未找到匹配的歌曲！', true, { recallMsg: 10 });
    }
    return true;
}

function ShareMusic_TextList(e, list, page, page_size, title = '') {
    let next_page = (page > 0 && list.length >= page_size) ? true : false;
    let message = [`---${title}---`];
    for (let i in list) {
        let music = list[i];
        let index = (page > 1) ? (((page - 1) * page_size) + Number(i) + 1) : (Number(i) + 1);
        message.push(index + '.' + music.name + '-' + music.artist);
    }
    message.push('----------------\n提示：直接发送序号点歌' + (next_page ? '，发送【#下一页】' : '') + '！');
    return message.join('\n');
}

async function ShareMusic_HtmlList(e, list, page, page_size, title = '') {
    let next_page = (page > 0 && list.length >= page_size) ? true : false;
    let start = Date.now();
    let new_list = list.map((music, i) => ({ index: (page > 1) ? ((page - 1) * page_size + i + 1) : (i + 1), name: music.name, artist: music.artist }));
    let saveId = String(new Date().getTime());
    let dir = `data/html/xiaofei-plugin/music_list`;
    Data.createDir(dir, 'root');
    let background_path = '';
    let background_url = await get_background();
    if (background_url) {
        try {
            let response = await fetch(background_url);
            let buffer = Buffer.from(await response.arrayBuffer());
            let file = `${process.cwd()}/${dir}/${saveId}.jpg`;
            fs.writeFileSync(file, buffer);
            background_path = file;
        } catch (err) { }
    }
    let data = { plugin_path: Plugin_Path, background_path: background_path || `${Plugin_Path}/resources/html/music_list/bg/default.jpg`, title: `${title.split('').join(' ')}`, tips: '直接发送序号点歌' + (next_page ? '，#下一页' : '') + '！', sub_title: `Created By ${Version.BotName} ${Version.yunzai} & xiaofei-Plugin ${Version.ver}`, list: new_list };
    let img = await xiaofei_plugin.puppeteer.screenshot("xiaofei-plugin/music_list", { saveId, tplFile: `${Plugin_Path}/resources/html/music_list/index.html`, data, imgType: 'jpeg', quality: 80 });
    setTimeout(() => { fs.unlink(`${process.cwd()}/${dir}/${saveId}.html`, () => { }); if (background_path) fs.unlink(background_path, () => { }); }, 100);
    logger.mark(`[小飞插件_列表图生成]${logger.green(`${Date.now() - start}ms`)}`);
    return (img && img?.type != 'image') ? segment.image(img) : img;
}

function get_MusicListId(e) {
    if (e.guild_id) return `guild_${e.channel_id}_${e.guild_id}_${e.self_id}`;
    if (e.group) return `group_${e.group?.gid || e.group.id}_${e.user_id}_${e.self_id}`;
    return `friend_${e.user_id}_${e.self_id}`;
}

async function get_background() {
    let background_temp = xiaofei_plugin.background_temp;
    if (background_temp && (new Date().getTime() - background_temp.time) < 1000 * 60 * 360) {
        let list = background_temp.data.data.list;
        let ext = list[random(0, list.length - 1)].ext[0];
        return ext.value[random(0, ext.value.length - 1)].url;
    }
    try {
        let res = await (await fetch('https://content-static.mihoyo.com/content/ysCn/getContentList?channelId=313&pageSize=1000&pageNum=1&isPreview=0')).json();
        if (res.retcode == 0 && res.data?.list) {
            xiaofei_plugin.background_temp = { data: res, time: new Date().getTime() };
            let ext = res.data.list[random(0, res.data.list.length - 1)].ext[0];
            return ext.value[random(0, ext.value.length - 1)].url;
        }
    } catch (err) { }
    return '';
}

async function music_search(e, search, source, page = 1, page_size = 10) {
    let list = [];
    let result = [];
    let setting = Config.getdefSet('setting', 'system') || {};
    let music_high_quality = setting['music_high_quality'];
    let is_text_search = false;
    const blacklist = ['鸣潮先约'];
    
    let value = {
        netease: {
            name: 'name', id: 'id',
            artist: (data) => {
                let ars = [];
                for (let index in data.ar) ars.push(data.ar[index].name);
                return ars.join('/');
            },
            pic: (data) => { return data.al ? data.al.picUrl + '?param=300x300' : no_pic; },
            link: (data) => { return 'http://music.163.com/#/song?id=' + data.id; },
            url: async (data) => {
                let url = 'http://music.163.com/song/media/outer/url?id=' + data.id;
                if (data.privilege && data.privilege.fee != 8 || music_high_quality) {
                    try {
                        let cookie = music_cookies.netease?.ck || '';
                        let options = {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 12; MI Build/SKQ1.211230.001)', 'Cookie': 'versioncode=8008070; os=android; channel=xiaomi; ;appver=8.8.70; ' + cookie },
                            body: `ids=${JSON.stringify([data.id])}&level=${music_high_quality ? 'exhigh' : 'standard'}&encodeType=mp3`
                        };
                        let response = await fetch('https://interface3.music.163.com/api/song/enhance/player/url/v1', options);
                        let res = await response.json();
                        if (res.code == 200) url = res.data[0]?.url || url;
                    } catch (err) { logger.error(err) }
                }
                return url;
            },
            lrc: async (data) => {
                let url = `https://music.163.com/api/song/lyric?id=${data.id}&lv=-1&tv=-1`;
                try {
                    let options = { method: 'GET', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36 Edg/105.0.1343.42', 'Referer': 'https://music.163.com/' } };
                    let response = await fetch(url, options);
                    let res = await response.json();
                    if (res.code == 200 && res.lrc?.lyric) {
                        let lrc = res.lrc.lyric;
                        if (res.tlyric.lyric) lrc = [lrc, res.tlyric.lyric];
                        return lrc;
                    }
                } catch (err) { }
                return '没有查询到这首歌的歌词！';
            }
        },
        kuwo: {
            name: 'SONGNAME', id: 'MUSICRID', artist: 'ARTIST',
            pic1: async (data) => {
                let url = `http://artistpicserver.kuwo.cn/pic.web?type=rid_pic&pictype=url&content=list&size=320&rid=${data.MUSICRID.substring(6)}`;
                let response = await fetch(url);
                let res = await response.text();
                return (res && res.indexOf('http') != -1) ? res : '';
            },
            pic: (data) => {
                let url = data.web_albumpic_short;
                return url ? 'http://img2.kuwo.cn/star/albumcover/' + url : (data.web_artistpic_short ? 'http://img2.kuwo.cn/star/starheads/' + data.web_artistpic_short : no_pic);
            },
            link: (data) => { return 'http://yinyue.kuwo.cn/play_detail/' + data.MUSICRID.substring(6); },
            url: async (data) => {
                try {
                    let response = await fetch(`https://www.kuwo.cn/api/v1/www/music/playUrl?mid=${data.MUSICRID.substring(6)}&type=convert_url&httpsStatus=1&reqId=${crypto.randomUUID()}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36', 'Referer': 'https://www.kuwo.cn/' } });
                    let res = await response.json();
                    if (res.data && res.data.url) return res.data.url;
                } catch (err) { logger.warn(`[小飞点歌] 酷我API(v1)获取失败，尝试兜底...`); }
                let anti_url = `http://antiserver.kuwo.cn/anti.s?useless=/resource/&format=mp3&rid=${data.MUSICRID}&response=url&type=convert_url&br=128kmp3`;
                try {
                    let response = await fetch(anti_url);
                    let text = await response.text();
                    if (text && text.startsWith('http')) return text;
                } catch (err) { logger.error(`[小飞点歌] 酷我antiserver兜底失败: ${err}`); }
                return '';
            },
            old_url: async (data) => {
                let url = `http://antiserver.kuwo.cn/anti.s?useless=/resource/&format=mp3&rid=${data.MUSICRID}&response=res&type=convert_url&br=128kmp3`;
                return url;
            },
            lrc: async (data) => {
                try {
                    let url = `http://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${data.MUSICRID.substring(6)}`;
                    let options = { method: 'GET', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36 Edg/105.0.1343.42', 'Referer': 'http://www.kuwo.cn/' } };
                    let response = await fetch(url, options);
                    let res = await response.json();
                    if (res.data?.lrclist) {
                        let lrc = [];
                        for (let val of res.data.lrclist) {
                            let i = parseInt((Number(val.time) / 60) % 60); if (String(i).length < 2) i = `0${i}`;
                            let s = parseInt(Number(val.time) % 60); if (String(s).length < 2) s = `0${s}`;
                            let ms = val.time.split('.')[1] || '00'; if (ms.length > 3) ms = ms.substring(0, 3);
                            lrc.push(`[${i}:${s}.${ms}]${val.lineLyric}`);
                        }
                        return lrc.join('\n');
                    }
                } catch (err) { }
                return '没有查询到这首歌的歌词！';
            }
        },
        qq: {
            name: (data) => { return data.title.replace(/\<(\/)?em\>/g, ''); },
            id: 'mid',
            artist: (data) => {
                let ars = [];
                for (let index in data.singer) ars.push(data.singer[index].name);
                return ars.join('/');
            },
            pic: (data) => {
                let album_mid = data.album ? data.album.mid : '';
                let singer_mid = data.singer ? data.singer[0].mid : '';
                let pic = (data.vs[1] && data.vs[1] != '') ? `T062R150x150M000${data.vs[1]}` : (album_mid != '' ? `T002R150x150M000${album_mid}` : (singer_mid != '' ? `T001R150x150M000${singer_mid}` : ''));
                return pic == '' ? no_pic : `http://y.gtimg.cn/music/photo_new/${pic}.jpg`;
            },
            link: (data) => { return 'https://y.qq.com/n/yqq/song/' + data.mid + '.html'; },
            url: async (data) => {
                let mid = data.mid;
                let code = md5(`${mid}q;z(&l~sdf2!nK`).substring(0, 5).toLocaleUpperCase();
                let play_url = `http://c6.y.qq.com/rsc/fcgi-bin/fcg_pyq_play.fcg?songid=&songmid=${mid}&songtype=1&fromtag=50&uin=${e?.self_id || e.bot?.uin}&code=${code}`;
                try {
                    let json_body = {
                        ...music_cookies.qqmusic.body,
                        "req_0": { "module": "vkey.GetVkeyServer", "method": "CgiGetVkey", "param": { "guid": md5(String(new Date().getTime())), "songmid": [mid], "songtype": [0], "uin": "0", "ctx": 1 } }
                    };
                    if (music_high_quality) {
                        let media_mid = data.file?.media_mid;
                        let quality = [['size_320mp3', 'M800', 'mp3'], ['size_192ogg', 'O600', 'ogg'], ['size_128mp3', 'M500', 'mp3'], ['size_96aac', 'C400', 'm4a']];
                        let filename = [], songtype = [];
                        for (let val of quality) {
                            if (data.file[val[0]] < 1) continue;
                            filename.push(`${val[1]}${media_mid}.${val[2]}`);
                            songtype.push(0);
                        }
                        if(filename.length > 0){
                            json_body.req_0.param.filename = filename;
                            json_body.req_0.param.songtype = songtype;
                            json_body.req_0.param.songmid = new Array(filename.length).fill(mid);
                        }
                    }
                    let options = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': '' }, body: JSON.stringify(json_body) };
                    let response = await fetch(`https://u.y.qq.com/cgi-bin/musicu.fcg`, options);
                    let res = await response.json();
                    if (res.req_0 && res.req_0?.code == '0') {
                        let midurlinfo = res.req_0.data.midurlinfo;
                        if (midurlinfo && midurlinfo.length > 0) {
                            for (let val of midurlinfo) {
                                if (val.purl) {
                                    play_url = 'http://ws.stream.qqmusic.qq.com/' + val.purl;
                                    break;
                                }
                            }
                        }
                    }
                } catch (err) { logger.error(`[小飞点歌] 获取QQ音乐链接失败: ${err}`); }
                return play_url;
            },
            lrc: async (data) => {
                let url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?_=${new Date().getTime()}&cv=4747474&ct=24&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=1&uin=0&g_tk_new_20200303=5381&g_tk=5381&loginUin=0&songmid=${data.mid}`;
                try {
                    let options = { method: 'GET', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36 Edg/105.0.1343.42', 'Referer': 'https://y.qq.com/' } };
                    let response = await fetch(url, options);
                    let res = await response.json();
                    if (res.lyric) {
                        let lrc = Buffer.from(res.lyric, 'base64').toString();
                        if (res.trans) lrc = [lrc, Buffer.from(res.trans, 'base64').toString()];
                        return lrc;
                    }
                } catch (err) { }
                return '没有查询到这首歌的歌词！';
            }
        },
        kugou: {
            name: 'songname', id: 'hash', artist: 'singername',
            pic: null, link: null, url: null, lrc: null,
            api: async (data, types, music_data = {}) => {
                let hash = data.hash || '', album_id = data.album_id || '', album_audio_id = data.album_audio_id || '', secret = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
                let params = { appid: 1014, clienttime: new Date().getTime(), clientver: 20000, dfid: '', album_id, album_audio_id, hash, mid: 123456789, platid: 4, srcappid: 2919, token: '', userid: 0, uuid: '' };
                let param = [];
                for (let key of Object.keys(params).sort()) param.push(`${key}=${params[key]}`);
                param.push(`signature=${md5(`${secret}${param.join("")}${secret}`)}`)
                let url = `https://wwwapi.kugou.com/play/songinfo?${param.join("&")}`;
                let response = await fetch(url);
                let res = await response.json();
                if (res.status != 1) return music_data;
                data = res.data;
                if (types.indexOf('pic') > -1) music_data.pic = data.img ? data.img : no_pic;
                if (types.indexOf('url') > -1) {
                    let key = md5(`${hash}mobileservice`);
                    music_data.url = `https://m.kugou.com/api/v1/wechat/index?cmd=101&hash=${hash}&key=${key}`;
                }
                if (types.indexOf('lrc') > -1) music_data.lrc = data.lyrics || '没有查询到这首歌的歌词！';
                if (types.indexOf('link') > -1) music_data.link = `https://www.kugou.com/song/#${data.encode_album_audio_id}`;
                return music_data;
            }
        },
        bilibili: {
            name: (data) => { return data.title.replace(/\<.*?\>/g, ''); },
            id: (data) => { return data.share?.video?.bvid; },
            artist: (data) => { return data.author.replace(/\<.*?\>/g, ''); },
            pic: (data) => { let url = data.cover || ''; if (url.indexOf('http') != 0) url = 'http:' + url; return url; },
            link: (data) => { return data.share?.video?.short_link || `https://www.bilibili.com/video/${data.share?.video?.bvid}`; },
            url: null, lrc: null,
            api: async (data, types, music_data = {}) => {
                let url = `https://api.bilibili.com/x/web-interface/view?bvid=${data.share?.video?.bvid}`;
                let response = await fetch(url);
                let res = await response.json();
                let info = res.data;
                if (types.indexOf('url') > -1) {
                    let url = `https://api.bilibili.com/x/tv/playurl`;
                    let time = parseInt(new Date().getTime() / 1000);
                    let params = { access_key: '', appkey: '1d8b6e7d45233436', build: 7210300, buvid: 'XU973E09237CC101E74F6E24CCF3DE3300D0B', c_locale: 'zh_CN', channel: 'xiaomi', cid: info.cid, disable_rcmd: 0, fnval: 16, fnver: 0, fourk: 1, is_dolby: 0, is_h265: 0, is_proj: 1, live_extra: '', mobi_app: 'android', mobile_access_key: '', object_id: info.aid, platform: 'android', playurl_type: 1, protocol: 1, qn: 64, s_locale: 'zh_CN', statistics: '%7B%22appId%22%3A1%2C%22platform%22%3A3%2C%22version%22%3A%227.21.0%22%2C%22abtest%22%3A%22%22%7D', sys_ver: 31, ts: time, video_type: 0 };
                    let param = [];
                    for (let key of Object.keys(params).sort()) param.push(`${key}=${params[key]}`);
                    param = param.join("&");
                    let sign = md5(`${param}560c52ccd288fed045859ed18bffd973`);
                    let response = await fetch(`${url}?${param}&sign=${sign}`);
                    let res = await response.json();
                    if (res.data?.dash?.audio && res.data?.dash?.audio.length > 0) {
                        let audios = res.data?.dash?.audio.sort((a, b) => a.id - b.id);
                        let play_url = audios[audios.length - 1].base_url;
                        if (!/https?\:\/\/\d+.\d+.\d+.\d+\/\/?/.test(play_url)) {
                            let backup_url = audios[audios.length - 1].backup_url;
                            for (let url of backup_url) { if (/https?\:\/\/\d+.\d+.\d+.\d+\/\/?/.test(url)) { play_url = url; break; } }
                        }
                        if (play_url) music_data.url = play_url.replace(/https?\:\/\/\d+.\d+.\d+.\d+\/\/?/, 'https://upos-sz-mirrorhw.bilivideo.com/');
                    } else if (res.data?.durl && res.data?.durl.length > 0) {
                        let play_url = res.data?.durl[0].url;
                        if (play_url) music_data.url = play_url.replace(/https?\:\/\/\d+.\d+.\d+.\d+\/\/?/, 'https://upos-sz-mirrorhw.bilivideo.com/');
                    }
                }
                return music_data;
            }
        }
    };

    switch (source) {
        case 'bilibili': result = await bilibili_search(search, page, page_size); break;
        case 'netease': result = await netease_search(search, page, page_size); break;
        case 'kuwo': result = await kuwo_search(search, page, page_size); break;
        case 'kugou': result = await kugou_search(search, page, page_size); break;
        case 'qq_radio': source = 'qq'; result = await qqmusic_radio(e.user_id, page_size); break;
        case 'qq_DailyRecommend': source = 'qq'; result = await qqmusic_getdiss(e.user_id, 0, 202, page, page_size); break;
        case 'qq_recommend': source = 'qq'; result = await qqmusic_recommend(e.user_id, page_size); break;
        case 'qq_like': source = 'qq'; result = await qqmusic_getdiss(e.user_id, 0, 201, page, page_size); break;
        case 'qq': default: source = 'qq'; is_text_search = true; result = await qqmusic_search(search, page, page_size); break;
    }

    if ((!result || !result.data || result.data.length == 0) && is_text_search) {
        const fallback = [{ id: 'netease', name: '网易云', fn: netease_search }, { id: 'kuwo', name: '酷我音乐', fn: kuwo_search }, { id: 'bilibili', name: 'Bilibili', fn: bilibili_search }];
        for (let p of fallback) {
            await e.reply(`QQ未找到，切换至[${p.name}]...`, true, { recallMsg: 2 });
            try { let res = await p.fn(search, page, page_size); if (res?.data?.length > 0) { result = res; source = p.id; break; } } catch (err) {}
            await sleep(800);
        }
    }

    if (result?.data?.length > 0) {
        for (let data of result.data) {
            let s_val = value[source];
            let name = typeof s_val.name == 'function' ? await s_val.name(data) : data[s_val.name];
            let artist = typeof s_val.artist == 'function' ? await s_val.artist(data) : data[s_val.artist];
            let isBlack = blacklist.some(kw => (name + artist).toLowerCase().includes(kw.toLowerCase()));
            if (!isBlack) list.push({ id: data[s_val.id] || name, name, artist, pic: s_val.pic, link: s_val.link, url: s_val.url, lrc: s_val.lrc, source, data, api: s_val.api });
        }
        if (list.length > 1 && search) {
            let kw = search.replace(/\s/g, '').toLowerCase();
            const prio = ['HOYO-MiX', '米哈游', 'Mihoyo', '三Z-STUDIO', '陈致逸'];
            list.sort((a, b) => {
                let hasA = a.name.toLowerCase().includes(kw), hasB = b.name.toLowerCase().includes(kw);
                if (hasA && !hasB) return -1; if (!hasA && hasB) return 1;
                if (hasA && hasB) {
                    let pA = prio.some(p => a.artist.includes(p)), pB = prio.some(p => b.artist.includes(p));
                    if (pA && !pB) return -1; if (!pA && pB) return 1;
                }
                return 0;
            });
        }
    }
    return { title: result?.title, author: result?.author, desc: result?.desc, page: result?.page || page, data: list, source };
}

async function CreateMusicShareJSON(data) {
    let music_json = { "app": "com.tencent.structmsg", "desc": "音乐", "view": "music", "ver": "0.0.0.1", "prompt": `[分享]${data.name}-${data.artist}`, "meta": { "music": { "app_type": 1, "appid": 100497308, "desc": data.artist, "jumpUrl": "", "musicUrl": "", "preview": "", "source_icon": "", "tag": "", "title": data.name } }, "config": { "type": "normal", "forward": true } };
    let m = music_json.meta.music;
    const info = { bilibili: [100951776, '哔哩哔哩', 'https://open.gtimg.cn/open/app_icon/00/95/17/76/100951776_100_m.png'], netease: [100495085, '网易云音乐', 'https://i.gtimg.cn/open/app_icon/00/49/50/85/100495085_100_m.png'], kuwo: [100243533, '酷我音乐', 'https://p.qpic.cn/qqconnect/0/app_100243533_1636374695/100'], kugou: [205141, '酷狗音乐', 'https://open.gtimg.cn/open/app_icon/00/20/51/41/205141_100_m.png'], qq: [100497308, 'QQ音乐', 'https://p.qpic.cn/qqconnect/0/app_100497308_1626060999/100'] };
    [m.appid, m.tag, m.source_icon] = info[data.source] || info.qq;
    if (typeof data.api == 'function') { let res = await data.api(data.data, ['url', 'pic', 'link']); Object.assign(data, res); }
    m.musicUrl = typeof data.url == 'function' ? await data.url(data.data) : data.url;
    m.preview = typeof data.pic == 'function' ? await data.pic(data.data) : data.pic;
    m.jumpUrl = typeof data.link == 'function' ? await data.link(data.data) : data.link;
    if (!m.musicUrl) { music_json.view = 'news'; music_json.meta.news = m; delete music_json.meta.music; }
    return music_json;
}

async function CreateMusicShare(e, data) {
    if (typeof data.api == 'function') { let res = await data.api(data.data, ['url', 'pic', 'link']); Object.assign(data, res); }
    let audio = typeof data.url == 'function' ? await data.url(data.data) : data.url;
    let image = typeof data.pic == 'function' ? await data.pic(data.data) : data.pic;
    let url = typeof data.link == 'function' ? await data.link(data.data) : data.link;
    Object.assign(data, { url: audio, pic: image, link: url });
    if (e.bot?.adapter?.name?.includes('OneBot')) {
        return { type: "music", data: data.source == 'netease' ? { type: "163", id: data.id } : { type: "custom", url, audio, title: data.name, image, content: data.artist } };
    }
    const apps = { bilibili: [100951776, 'tv.danmaku.bili', '7194d531cbe7960a22007b9f6bdaa38b'], netease: [100495085, 'com.netease.cloudmusic', 'da6b069da1e2982db3e386233f68d76d'], kuwo: [100243533, 'cn.kuwo.player', 'bf9ff4ffb4c558a34ee3fd52c223ebf5'], kugou: [205141, 'com.kugou.android', 'fe4a24d80fcf253a00676a808f62c2c6'], qq: [100497308, 'com.tencent.qqmusic', 'cbd27cd7c861227d013a25b2d10f0799'] };
    let [appid, appname, appsign] = apps[data.source] || apps.qq;
    return { 1: appid, 2: 1, 3: audio ? 4 : 0, 5: { 1: 1, 2: "0.0.0", 3: appname, 4: appsign }, 10: e.isGroup ? 1 : 0, 11: e.isGroup ? e.group.gid : (e.friend.uin || e.user_id), 12: { 10: data.name, 11: data.artist, 12: `[分享]${data.name}`, 13: url, 14: image, 16: audio } };
}

async function SendMusicShare(e, body, music) {
    const ONEBOT_UNSUPPORTED_MUSIC = ['bilibili', 'kuwo', 'kugou', 'migu'];
    if ((e.bot?.adapter === 'OneBotv11' || e.bot?.adapter?.name === 'OneBotv11') && music && ONEBOT_UNSUPPORTED_MUSIC.includes(music.source)) {
        return await SendMediaCardInstead(e, music);
    }
    let sendSuccess = false;
    let failReason = "";

    try {
        if (e.bot?.adapter === 'OneBotv11' || e.bot?.adapter?.name === 'OneBotv11') {
            try {
                let ret = await e.reply(body);
                if (ret && (ret.status === 'failed' || ret.retcode !== 0)) throw new Error(ret.message || ret.wording || "发送返回失败状态");
                sendSuccess = true;
            } catch (err) {
                sendSuccess = false;
                failReason = `OneBot发送报错: ${err.message || err}`;
            }
        } else if (e.bot.sendOidb) {
            let payload = await e.bot.sendOidb("OidbSvc.0xb77_9", core.pb.encode(body));
            let result = core.pb.decode(payload);
            if (result[3] == 0) sendSuccess = true;
            else { sendSuccess = false; failReason = `Oidb错误码: ${result[3]}`; }
        } else {
            sendSuccess = false; failReason = "协议不支持";
        }
    } catch (err) { sendSuccess = false; failReason = err.message; }

    if (sendSuccess) return true;

    if (!music || !music.url) return false;

    // ===== 【完美分离逻辑】 =====
    try {
        // 1. 先发物理兜底链接，【不撤回】，让用户随时有备用选项
        await e.reply(`卡片发送失败，已提取备用链接：\n━━━━━━━━━━━━\n歌名：${music.name}\n歌手：${music.artist}\n链接：${music.link || music.url}`);

        // 2. 再发防傻等提示，【自动撤回】，保持群聊清爽
        await e.reply(`正在尝试转为语音模式(可能需1-3分钟)，请稍候...`, true, { recallMsg: 45 });

        let msgRes;
        let useUploadRecord = false;
        if (e.bot.sendUni) {
            try {
                msgRes = await uploadRecord(e, music.url, 0, true, `${music.name}-${music.artist}`);
                useUploadRecord = true;
            } catch { }
        }

        if (!useUploadRecord || !msgRes) {
            let voiceUrl = music.url;
            if (typeof toSilk === 'function') {
                try { voiceUrl = await toSilk(music.url) || voiceUrl; } catch { }
            }
            msgRes = await segment.record(voiceUrl);
        }

        if (msgRes) {
            try {
                await e.reply(msgRes);
            } catch (replyErr) {
                logger.error(`[小飞点歌] 兜底语音发送超时或崩溃: ${replyErr}`);
                await e.reply(`⚠️ 语音生成/发送超时失败！文件可能过大，请直接点击上方链接收听。`);
            }
        } else {
            await e.reply("⚠️ 语音生成失败，请点击上方链接收听。");
        }
    } catch (err) { 
        logger.error(`[小飞点歌] 兜底语音整体逻辑异常: ${err}`);
    }
    return false;
}

async function SendMediaCardInstead(e, music) {
    try {
        await e.reply([segment.image(music.pic), `【${SOURCE_NAME_MAP[music.source] || '音乐'}】${music.name}\n歌手：${music.artist}\n${music.link}`]);
        if (music.url) {
            try {
                await e.reply(await segment.record(typeof toSilk == 'function' ? await toSilk(music.url) || music.url : music.url));
            } catch (err) {
                await e.reply("⚠️ 语音发送超时，请点上方链接收听。");
            }
        }
        return true;
    } catch (err) { return false; }
}

async function get_qqmusic_userinfo(ck = null) {
	try {
		let url = `https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?_=${new Date().getTime()}&cv=4747474&ct=24&format=json&inCharset=utf-8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0&uin=0&g_tk_new_20200303=5381&g_tk=5381&cid=205360838&userid=0&reqfrom=1&reqtype=0&hostUin=0&loginUin=0`;
		let cookies = getCookie(ck) || getCookie(music_cookies.qqmusic.ck) || [];

		let options = {
			method: 'GET',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Cookie': cookies.join('; ')
			}
		};

		let response = await fetch(url, options); //调用接口获取数据
		let res = await response.json();
		if (res?.code == '0' && res.data?.creator) {
			let creator = res.data.creator;
			return {
				code: 1, data: {
					userid: ck.get('uin') || ck.get('wxuin'),
					nickname: creator.nick,
					is_vip: await is_qqmusic_vip(ck.get('uin') || ck.get('wxuin'), cookies.join('; '))
				}
			};
		}
	} catch (err) { }
	return { code: -1 };
}

async function is_qqmusic_vip(uin, cookies = null) {
	let json = {
		"comm": { "cv": 4747474, "ct": 24, "format": "json", "inCharset": "utf-8", "outCharset": "utf-8", "notice": 0, "platform": "yqq.json", "needNewCode": 1, "uin": 0, "g_tk_new_20200303": 5381, "g_tk": 5381 },
		"req_0": {
			"module": "userInfo.VipQueryServer",
			"method": "SRFVipQuery_V2",
			"param": {
				"uin_list": [uin]
			}
		}
	};
	let options = {
		method: 'POST',//post请求 
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Cookie': cookies || Bot?.cookies?.['y.qq.com']
		},
		body: JSON.stringify(json)
	};

	let url = `https://u.y.qq.com/cgi-bin/musicu.fcg`;
	try {
		let response = await fetch(url, options); //调用接口获取数据
		let res = await response.json();
		if (res.req_0 && res.req_0?.code == '0') {
			let data = res.req_0.data?.infoMap?.[uin];
			if (data.iVipFlag == 1 || data.iSuperVip == 1 || data.iNewVip == 1 || data.iNewSuperVip == 1) {
				return true;
			}
		}
	} catch (err) { }
	return false;
}

async function kugou_search(search, page = 1, page_size = 10) {
	try {
		let url = `http://msearchcdn.kugou.com/api/v3/search/song?page=${page}&pagesize=${page_size}&keyword=${encodeURI(search)}`;
		let response = await fetch(url, { method: "get" }); //调用接口获取数据
		let res = await response.json(); //结果json字符串转对象
		if (!res.data || res.data.info < 1) {
			return [];
		}
		return { page: page, data: res.data.info };
	} catch (err) { }

	return null;
}


async function qqmusic_refresh_token(cookies, type) {
	let result = { code: -1 };
	let json_body = {
		...music_cookies.qqmusic.body,
		req_0: {
			"method": "Login",
			"module": "music.login.LoginServer",
			"param": {
				"access_token": "",
				"expired_in": 0,
				"forceRefreshToken": 0,
				"musicid": 0,
				"musickey": "",
				"onlyNeedAccessToken": 0,
				"openid": "",
				"refresh_token": "",
				"unionid": ""
			}
		}
	};
	let req_0 = json_body.req_0;
	if (type == 0) {
		req_0.param.appid = 100497308;
		req_0.param.access_token = cookies.get("psrf_qqaccess_token") || '';
		req_0.param.musicid = Number(cookies.get("uin") || '0');
		req_0.param.openid = cookies.get("psrf_qqopenid") || '';
		req_0.param.refresh_token = cookies.get("psrf_qqrefresh_token") || '';
		req_0.param.unionid = cookies.get("psrf_qqunionid") || '';
	} else if (type == 1) {
		req_0.param.strAppid = "wx48db31d50e334801";
		req_0.param.access_token = cookies.get("wxaccess_token") || '';
		req_0.param.str_musicid = cookies.get("wxuin") || '0';
		req_0.param.openid = cookies.get("wxopenid") || '';
		req_0.param.refresh_token = cookies.get("wxrefresh_token") || '';
		req_0.param.unionid = cookies.get("wxunionid") || '';
	} else {
		return result;
	}
	req_0.param.musickey = (cookies.get("qqmusic_key") || cookies.get("qm_keyst")) || '';

	let options = {
		method: 'POST',//post请求 
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: JSON.stringify(json_body)
	};

	let url = `https://u.y.qq.com/cgi-bin/musicu.fcg`;
	try {
		let response = await fetch(url, options); //调用接口获取数据
		let res = await response.json(); //结果json字符串转对象
		if (res.req_0?.code == '0') {
			let map = new Map();
			let data = res.req_0?.data;
			if (type == 0) {
				map.set("psrf_qqopenid", data.openid);
				map.set("psrf_qqrefresh_token", data.refresh_token);
				map.set("psrf_qqaccess_token", data.access_token);
				map.set("psrf_access_token_expiresAt", data.expired_at);
				map.set("uin", String(data.str_musicid || data.musicid) || '0');
				map.set("qqmusic_key", data.musickey);
				map.set("qm_keyst", data.musickey);
				map.set("psrf_musickey_createtime", data.musickeyCreateTime);
				map.set("psrf_qqunionid", data.unionid);
				map.set("euin", data.encryptUin);
				map.set("login_type", 1);
				map.set("tmeLoginType", 2);
				result.code = 1;
				result.data = map;
			} else if (type == 1) {
				map.set("wxopenid", data.openid);
				map.set("wxrefresh_token", data.refresh_token);
				map.set("wxaccess_token", data.access_token);
				map.set("wxuin", String(data.str_musicid || data.musicid) || '0');
				map.set("qqmusic_key", data.musickey);
				map.set("qm_keyst", data.musickey);
				map.set("psrf_musickey_createtime", data.musickeyCreateTime);
				map.set("wxunionid", data.unionid);
				map.set("euin", data.encryptUin);
				map.set("login_type", 2);
				map.set("tmeLoginType", 1);
				result.code = 1;
				result.data = map;
			}
		}
	} catch (err) {
		logger.error(err);
	}
	return result;
}

async function qqmusic_GetTrackInfo(ids) {
	try {
		let json_body = {
			...JSON.parse(JSON.stringify(music_cookies.qqmusic.body)),
			"req_0": { "module": "track_info.UniformRuleCtrlServer", "method": "GetTrackInfo", "param": {} }
		};
		let types = [];
		for (let i in ids) {
			ids[i] = parseInt(ids[i]);
			types.push(200);
		}
		json_body.req_0.param = {
			ids: ids,
			types: types
		};
		let options = {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: JSON.stringify(json_body)
		};

		let url = `https://u.y.qq.com/cgi-bin/musicu.fcg`;
		let response = await fetch(url, options);
		let res = await response.json();

		if (res.code != '0' && res.req_0.code != '0') {
			return null;
		}

		let data = res.req_0?.data?.tracks;
		data = data ? data : [];
		return { page: 0, data: data };
	} catch (err) { }
	return null;
}

async function qqmusic_recommend(uin, page_size) {
	try {
		let json_body = {
			"comm": { "g_tk": 5381, "uin": uin, "format": "json", "ct": 20, "cv": 1803, "platform": "wk_v17" },
			"req_0": { "module": "recommend.RecommendFeedServer", "method": "get_recommend_feed", "param": { "direction": 1, "page": 1, "v_cache": [], "v_uniq": [], "s_num": 0 } }
		};
		json_body.comm.guid = md5(String(new Date().getTime()));
		json_body.comm.uin = uin;
		json_body.comm.tmeLoginType = 2;
		json_body.comm.psrf_qqunionid = '';
		json_body.comm.authst = '';
		let options = {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: JSON.stringify(json_body)
		};

		let url = `https://u.y.qq.com/cgi-bin/musicu.fcg`;
		let response = await fetch(url, options);
		let res = await response.json();

		if (res.code != '0' && res.req_0.code != '0') {
			return null;
		}
		let v_card = [];
		for (let v_shelf of res.req_0?.data?.v_shelf) {
			if (v_shelf.style == 1) {
				for (let v_niche of v_shelf.v_niche) {
					v_card = v_card.concat(v_niche.v_card);
				}
			}
		}

		let ids = [];
		for (let val of v_card) {
			if (ids.length >= page_size) break;
			ids.push(val.id);
		}

		return await qqmusic_GetTrackInfo(ids);
	} catch (err) { }
	return null;
}

async function qqmusic_radio(uin, page_size) {
	try {
		let json_body = {
			...JSON.parse(JSON.stringify(music_cookies.qqmusic.body)),
			"req_0": { "method": "get_radio_track", "module": "pc_track_radio_svr", "param": { "id": 99, "num": 1 } }
		};
		json_body.comm.guid = md5(String(new Date().getTime()));
		json_body.comm.uin = uin;
		json_body.comm.tmeLoginType = 2;
		json_body.comm.psrf_qqunionid = '';
		json_body.comm.authst = '';
		json_body.req_0.param.num = page_size;

		let options = {
			method: 'POST',//post请求 
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: JSON.stringify(json_body)
		};

		let url = `https://u.y.qq.com/cgi-bin/musicu.fcg`;
		let response = await fetch(url, options); //调用接口获取数据
		let res = await response.json(); //结果json字符串转对象

		if (res.code != '0' && res.req_0.code != '0') {
			return null;
		}

		let data = res.req_0?.data?.tracks;
		data = data ? data : [];
		return { page: 0, data: data };
	} catch (err) { }

	return null;
}

async function qqmusic_getdiss(uin = 0, disstid = 0, dirid = 202, page = 1, page_size = 30) {
	try {
		let json_body = {
			...JSON.parse(JSON.stringify(music_cookies.qqmusic.body)),
			"req_0": { "module": "srf_diss_info.DissInfoServer", "method": "CgiGetDiss", "param": { "disstid": 0, "dirid": 202, "onlysonglist": 0, "song_begin": 0, "song_num": 500, "userinfo": 1, "pic_dpi": 800, "orderlist": 1 } }
		};
		json_body.comm.guid = md5(String(new Date().getTime()));
		json_body.comm.uin = uin;
		json_body.comm.tmeLoginType = 2;
		json_body.comm.psrf_qqunionid = '';
		json_body.comm.authst = '';
		json_body.req_0.param.song_num = page_size;
		json_body.req_0.param.song_begin = ((page < 1 ? 1 : page) * page_size) - page_size;
		json_body.req_0.param.disstid = disstid;
		json_body.req_0.param.dirid = dirid;

		let options = {
			method: 'POST',//post请求 
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: JSON.stringify(json_body)
		};

		let url = `https://u.y.qq.com/cgi-bin/musicu.fcg`;
		let response = await fetch(url, options); //调用接口获取数据
		let res = await response.json(); //结果json字符串转对象

		if (res.code != '0' && res.req_0.code != '0') {
			return null;
		}

		let dirinfo = res.req_0?.data?.dirinfo || {};
		let data = res.req_0?.data?.songlist;
		data = data ? data : [];
		return { title: dirinfo.title, desc: dirinfo.desc, page: page, data: data };
	} catch (err) { }

	return null;
}


async function bilibili_search(search, page = 1, page_size = 10) {
	try {
		let url = `https://app.bilibili.com/x/v2/search/type`;
		let time = parseInt(new Date().getTime() / 1000);
		let params = {
			access_key: '',
			appkey: '1d8b6e7d45233436',
			build: 7210300,
			buvid: 'XU973E09237CC101E74F6E24CCF3DE3300D0B',
			c_locale: 'zh_CN',
			channel: 'xiaomi',
			disable_rcmd: 0,
			fnval: 16,//130
			fnver: 0,
			fourk: 1,
			is_dolby: 0,
			is_h265: 0,
			is_proj: 1,
			live_extra: '',
			mobi_app: 'android',
			mobile_access_key: '',
			platform: 'android',
			playurl_type: 1,
			protocol: 1,
			qn: 64,
			s_locale: 'zh_CN',
			statistics: '%7B%22appId%22%3A1%2C%22platform%22%3A3%2C%22version%22%3A%227.21.0%22%2C%22abtest%22%3A%22%22%7D',
			sys_ver: 31,
			ts: time,
			video_type: 0,
			keyword: encodeURI(search),
			type: 10,
			pn: page,
			ps: page_size
		};
		let param = [];
		for (let key of Object.keys(params).sort()) {
			param.push(`${key}=${params[key]}`);
		}
		param = param.join("&");
		let sign = md5(`${param}560c52ccd288fed045859ed18bffd973`);
		param += `&sign=${sign}`;
		let response = await fetch(`${url}?${param}`);
		let res = await response.json();
		if (!res.data?.items || res.data?.items.length < 1) {
			return null;
		}
		return { page: page, data: res.data?.items };
	} catch (err) { }
	return null;
}

async function qqmusic_search(search, page = 1, page_size = 10) {
	try {
		let qq_search_json = {
			"comm": { "uin": "0", "authst": "", "ct": 29 },
			"search": {
				"method": "DoSearchForQQMusicMobile",
				"module": "music.search.SearchCgiService",
				"param": {
					"grp": 1,
					"num_per_page": 40,
					"page_num": 1,
					"query": "",
					"remoteplace": "miniapp.1109523715",
					"search_type": 0,
					"searchid": String(Math.floor(Math.random() * 10000000))
				}
			}
		};

		qq_search_json['search']['param']['query'] = search;
		qq_search_json['search']['param']['page_num'] = page;
		qq_search_json['search']['param']['num_per_page'] = page_size;

		let options = {
			method: 'POST',//post请求 
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
				'Content-Type': 'application/json',
				'Cookie': Bot?.cookies?.['y.qq.com'] || Config.getConfig('music', 'cookies')?.qqmusic || ''
			},
			body: JSON.stringify(qq_search_json)
		};

		let url = `https://u.y.qq.com/cgi-bin/musicu.fcg`;

		let response = await fetch(url, options); //调用接口获取数据

		let res = await response.json(); //结果json字符串转对象

		if (res.code != '0') {
			return null;
		}
		let body = res.search?.data?.body || {};
		return { page: page, data: body.song?.list || body.item_song || [] };
	} catch (err) { }

	return null;
}

async function netease_search(search, page = 1, page_size = 10) {
	try {
		let offset = page < 1 ? 0 : page;
		offset = (page_size * page) - page_size;
		let url = 'http://music.163.com/api/cloudsearch/pc';
		let options = {
			method: 'POST',//post请求 
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Cookie': music_cookies.netease.ck
			},
			body: `offset=${offset}&limit=${page_size}&type=1&s=${encodeURI(search)}`
		};

		let response = await fetch(url, options); //调用接口获取数据
		let res = await response.json(); //结果json字符串转对象

		if (res.result.songs < 1) {
			return null;
		}
		return { page: page, data: res.result.songs };
	} catch (err) { }

	return null;
}

async function kuwo_search(search, page = 1, page_size = 10) {
	try {
		let url = `http://search.kuwo.cn/r.s?user=&android_id=&prod=kwplayer_ar_10.1.2.1&corp=kuwo&newver=3&vipver=10.1.2.1&source=kwplayer_ar_10.1.2.1_40.apk&p2p=1&q36=&loginUid=&loginSid=&notrace=0&client=kt&all=${search}&pn=${page - 1}&rn=${page_size}&uid=&ver=kwplayer_ar_10.1.2.1&vipver=1&show_copyright_off=1&newver=3&correct=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&searchapi=5&issubtitle=1&province=&city=&latitude=&longtitude=&userIP=&searchNo=&spPrivilege=0`;
		let response = await fetch(url, { method: "get" }); //调用接口获取数据
		let res = await response.json(); //结果json字符串转对象
		if (res.abslist.length < 1) {
			return null;
		}
		return { page: page, data: res.abslist };
	} catch (err) { }

	return null;
    
async function get_bilibili_userinfo(ck) {
    try {
        let res = await (await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: { 'Cookie': ck || music_cookies.bilibili.ck } })).json();
        if (res.code === 0 && res.data?.isLogin) return { code: 1, data: { userid: res.data.mid, nickname: res.data.uname, is_vip: res.data.vipStatus === 1 } };
    } catch (err) {}
    return { code: -1 };
}

function getCookieMap(cookie) {
    let map = new Map();
    cookie.replace(/\s*/g, "").split(";").forEach(v => { let [k, val] = v.split("="); if (k) map.set(k, val); });
    return map;
}

function getCookie(map) {
    let arr = [];
    for (let [k, v] of map) arr.push(`${k}=${v}`);
    return arr;
}

function random(min, max) { return min + Math.round(Math.random() * (max - min)); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ==================== 请将以下代码追加到文件最底部 ====================

async function bilibili_search(search, page = 1, page_size = 10) {
    try {
        let url = `https://api.bilibili.com/x/web-interface/search/type`;
        let cookie = music_cookies.bilibili.ck || '';
        const buvid3 = (crypto.randomUUID() + 'infoc').toUpperCase();
        if (!cookie.includes('buvid3=')) cookie += `; buvid3=${buvid3};`;
        let params = new URLSearchParams({ search_type: 'video', keyword: search, page: page, order: 'totalrank', tids: 0, highlight: 0 });
        let response = await fetch(`${url}?${params}`, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://search.bilibili.com/', 'Cookie': cookie } });
        let contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            let res = await response.json();
            if (res.code === 0 && res.data && res.data.result && res.data.result.length > 0) {
                let items = res.data.result.map(item => { return { title: item.title.replace(/<.*?>/g, ''), author: item.author, cover: item.pic.startsWith('http') ? item.pic : `http:${item.pic}`, share: { video: { bvid: item.bvid, short_link: item.arcurl } } }; });
                return { page: page, data: items };
            }
        }
    } catch (err) { }
    try {
        let url = `https://app.bilibili.com/x/v2/search/type`;
        let time = parseInt(new Date().getTime() / 1000);
        let params = { access_key: '', appkey: '1d8b6e7d45233436', build: 7210300, buvid: 'XU973E09237CC101E74F6E24CCF3DE3300D0B', c_locale: 'zh_CN', channel: 'xiaomi', disable_rcmd: 0, fnval: 16, fnver: 0, fourk: 1, mobi_app: 'android', platform: 'android', qn: 64, s_locale: 'zh_CN', statistics: '%7B%22appId%22%3A1%2C%22platform%22%3A3%2C%22version%22%3A%227.21.0%22%2C%22abtest%22%3A%22%22%7D', sys_ver: 31, ts: time, video_type: 0, keyword: encodeURIComponent(search), type: 10, pn: page, ps: page_size, order: 'totalrank' };
        let param = [];
        for (let key of Object.keys(params).sort()) param.push(`${key}=${params[key]}`);
        param = param.join("&");
        let sign = md5(`${param}560c52ccd288fed045859ed18bffd973`);
        let response = await fetch(`${url}?${param}&sign=${sign}`);
        let res = await response.json();
        if (res.data?.items && res.data.items.length > 0) return { page: page, data: res.data.items };
    } catch (err) { }
    return null;
}

async function netease_search(search, page = 1, page_size = 10) {
    try {
        let offset = page < 1 ? 0 : page;
        offset = (page_size * page) - page_size;
        let url = 'http://music.163.com/api/cloudsearch/pc';
        let options = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': music_cookies.netease.ck }, body: `offset=${offset}&limit=${page_size}&type=1&s=${encodeURI(search)}` };
        let response = await fetch(url, options);
        let res = await response.json();
        if (res.result.songs < 1) return null;
        return { page: page, data: res.result.songs };
    } catch (err) { }
    return null;
}

async function kuwo_search(search, page = 1, page_size = 10) {
    try {
        let url = `http://search.kuwo.cn/r.s?user=&android_id=&prod=kwplayer_ar_10.1.2.1&corp=kuwo&newver=3&vipver=10.1.2.1&source=kwplayer_ar_10.1.2.1_40.apk&p2p=1&q36=&loginUid=&loginSid=&notrace=0&client=kt&all=${search}&pn=${page - 1}&rn=${page_size}&uid=&ver=kwplayer_ar_10.1.2.1&vipver=1&show_copyright_off=1&newver=3&correct=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&searchapi=5&issubtitle=1&province=&city=&latitude=&longtitude=&userIP=&searchNo=&spPrivilege=0`;
        let response = await fetch(url, { method: "get" });
        let res = await response.json();
        if (res.abslist.length < 1) return null;
        return { page: page, data: res.abslist };
    } catch (err) { }
    return null;
}

async function kugou_search(search, page = 1, page_size = 10) {
    try {
        let url = `http://msearchcdn.kugou.com/api/v3/search/song?page=${page}&pagesize=${page_size}&keyword=${encodeURI(search)}`;
        let response = await fetch(url, { method: "get" });
        let res = await response.json();
        if (!res.data || res.data.info < 1) return [];
        return { page: page, data: res.data.info };
    } catch (err) { }
    return null;
}

async function qqmusic_search(search, page = 1, page_size = 10) {
    try {
        let cookie_str = '';
        let ck_map = music_cookies.qqmusic.ck;
        if (ck_map && ck_map.size > 0) {
            let cookie_arr = getCookie(ck_map);
            cookie_str = cookie_arr.join('; ');
        }
        let query_body = {
            "comm": { "uin": ck_map ? (ck_map.get('uin') || 0) : 0, "authst": ck_map ? (ck_map.get('qqmusic_key') || "") : "", "ct": 24, "cv": 4747474 },
            "req_1": { "method": "DoSearchForQQMusicMobile", "module": "music.search.SearchCgiService", "param": { "grp": 1, "num_per_page": page_size, "page_num": page, "query": search, "search_type": 0, "userid": 0 } }
        };
        let url = `https://u.y.qq.com/cgi-bin/musicu.fcg`;
        let response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://y.qq.com/', 'Cookie': cookie_str }, body: JSON.stringify(query_body) });
        let res = await response.json();
        if (res.code != 0 || res.req_1?.code != 0) return null;
        let body = res.req_1?.data?.body || {};
        let list = body.song?.list || body.item_song || [];
        if (list.length > 0) return { page: page, data: list };
    } catch (err) { }
    return null;
}

async function qqmusic_radio(uin, page_size) {
    try {
        let json_body = { ...JSON.parse(JSON.stringify(music_cookies.qqmusic.body)), "req_0": { "method": "get_radio_track", "module": "pc_track_radio_svr", "param": { "id": 99, "num": 1 } } };
        json_body.comm.guid = md5(String(new Date().getTime())); json_body.comm.uin = uin; json_body.comm.tmeLoginType = 2; json_body.comm.psrf_qqunionid = ''; json_body.comm.authst = ''; json_body.req_0.param.num = page_size;
        let options = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: JSON.stringify(json_body) };
        let url = `https://u.y.qq.com/cgi-bin/musicu.fcg`;
        let response = await fetch(url, options);
        let res = await response.json();
        if (res.code != '0' && res.req_0.code != '0') return null;
        let data = res.req_0?.data?.tracks;
        return { page: 0, data: data ? data : [] };
    } catch (err) { }
    return null;
}

async function qqmusic_recommend(uin, page_size) {
    try {
        let json_body = { "comm": { "g_tk": 5381, "uin": uin, "format": "json", "ct": 20, "cv": 1803, "platform": "wk_v17" }, "req_0": { "module": "recommend.RecommendFeedServer", "method": "get_recommend_feed", "param": { "direction": 1, "page": 1, "v_cache": [], "v_uniq": [], "s_num": 0 } } };
        json_body.comm.guid = md5(String(new Date().getTime())); json_body.comm.uin = uin; json_body.comm.tmeLoginType = 2; json_body.comm.psrf_qqunionid = ''; json_body.comm.authst = '';
        let options = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: JSON.stringify(json_body) };
        let url = `https://u.y.qq.com/cgi-bin/musicu.fcg`;
        let response = await fetch(url, options);
        let res = await response.json();
        if (res.code != '0' && res.req_0.code != '0') return null;
        let v_card = [];
        for (let v_shelf of res.req_0?.data?.v_shelf) {
            if (v_shelf.style == 1) for (let v_niche of v_shelf.v_niche) v_card = v_card.concat(v_niche.v_card);
        }
        let ids = [];
        for (let val of v_card) {
            if (ids.length >= page_size) break;
            ids.push(val.id);
        }
        return await qqmusic_GetTrackInfo(ids);
    } catch (err) { }
    return null;
}

async function qqmusic_getdiss(uin = 0, disstid = 0, dirid = 202, page = 1, page_size = 30) {
    try {
        let json_body = { ...JSON.parse(JSON.stringify(music_cookies.qqmusic.body)), "req_0": { "module": "srf_diss_info.DissInfoServer", "method": "CgiGetDiss", "param": { "disstid": 0, "dirid": 202, "onlysonglist": 0, "song_begin": 0, "song_num": 500, "userinfo": 1, "pic_dpi": 800, "orderlist": 1 } } };
        json_body.comm.guid = md5(String(new Date().getTime())); json_body.comm.uin = uin; json_body.comm.tmeLoginType = 2; json_body.comm.psrf_qqunionid = ''; json_body.comm.authst = ''; json_body.req_0.param.song_num = page_size; json_body.req_0.param.song_begin = ((page < 1 ? 1 : page) * page_size) - page_size; json_body.req_0.param.disstid = disstid; json_body.req_0.param.dirid = dirid;
        let options = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: JSON.stringify(json_body) };
        let url = `https://u.y.qq.com/cgi-bin/musicu.fcg`;
        let response = await fetch(url, options);
        let res = await response.json();
        if (res.code != '0' && res.req_0.code != '0') return null;
        let dirinfo = res.req_0?.data?.dirinfo || {};
        let data = res.req_0?.data?.songlist;
        return { title: dirinfo.title, author: dirinfo.nick, desc: dirinfo.desc, page: page, data: data ? data : [] };
    } catch (err) { }
    return null;
}

async function qqmusic_GetTrackInfo(ids) {
    try {
        let json_body = { ...JSON.parse(JSON.stringify(music_cookies.qqmusic.body)), "req_0": { "module": "track_info.UniformRuleCtrlServer", "method": "GetTrackInfo", "param": {} } };
        let types = [];
        for (let i in ids) { ids[i] = parseInt(ids[i]); types.push(200); }
        json_body.req_0.param = { ids: ids, types: types };
        let options = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: JSON.stringify(json_body) };
        let url = `https://u.y.qq.com/cgi-bin/musicu.fcg`;
        let response = await fetch(url, options);
        let res = await response.json();
        if (res.code != '0' && res.req_0.code != '0') return null;
        let data = res.req_0?.data?.tracks;
        return { page: 0, data: data ? data : [] };
    } catch (err) { }
    return null;
}

async function qqmusic_refresh_token(cookies, type) {
    let result = { code: -1 };
    let json_body = { ...music_cookies.qqmusic.body, req_0: { "method": "Login", "module": "music.login.LoginServer", "param": { "access_token": "", "expired_in": 0, "forceRefreshToken": 0, "musicid": 0, "musickey": "", "onlyNeedAccessToken": 0, "openid": "", "refresh_token": "", "unionid": "" } } };
    let req_0 = json_body.req_0;
    if (type == 0) { req_0.param.appid = 100497308; req_0.param.access_token = cookies.get("psrf_qqaccess_token") || ''; req_0.param.musicid = Number(cookies.get("uin") || '0'); req_0.param.openid = cookies.get("psrf_qqopenid") || ''; req_0.param.refresh_token = cookies.get("psrf_qqrefresh_token") || ''; req_0.param.unionid = cookies.get("psrf_qqunionid") || ''; }
    else if (type == 1) { req_0.param.strAppid = "wx48db31d50e334801"; req_0.param.access_token = cookies.get("wxaccess_token") || ''; req_0.param.str_musicid = cookies.get("wxuin") || '0'; req_0.param.openid = cookies.get("wxopenid") || ''; req_0.param.refresh_token = cookies.get("wxrefresh_token") || ''; req_0.param.unionid = cookies.get("wxunionid") || ''; }
    else { return result; }
    req_0.param.musickey = (cookies.get("qqmusic_key") || cookies.get("qm_keyst")) || '';
    let options = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: JSON.stringify(json_body) };
    let url = `https://u.y.qq.com/cgi-bin/musicu.fcg`;
    try {
        let response = await fetch(url, options);
        let res = await response.json();
        if (res.req_0?.code == '0') {
            let map = new Map(); let data = res.req_0?.data;
            if (type == 0) { map.set("psrf_qqopenid", data.openid); map.set("psrf_qqrefresh_token", data.refresh_token); map.set("psrf_qqaccess_token", data.access_token); map.set("psrf_access_token_expiresAt", data.expired_at); map.set("uin", String(data.str_musicid || data.musicid) || '0'); map.set("qqmusic_key", data.musickey); map.set("qm_keyst", data.musickey); map.set("psrf_musickey_createtime", data.musickeyCreateTime); map.set("psrf_qqunionid", data.unionid); map.set("euin", data.encryptUin); map.set("login_type", 1); map.set("tmeLoginType", 2); result.code = 1; result.data = map; }
            else if (type == 1) { map.set("wxopenid", data.openid); map.set("wxrefresh_token", data.refresh_token); map.set("wxaccess_token", data.access_token); map.set("wxuin", String(data.str_musicid || data.musicid) || '0'); map.set("qqmusic_key", data.musickey); map.set("qm_keyst", data.musickey); map.set("psrf_musickey_createtime", data.musickeyCreateTime); map.set("wxunionid", data.unionid); map.set("euin", data.encryptUin); map.set("login_type", 2); map.set("tmeLoginType", 1); result.code = 1; result.data = map; }
        }
    } catch (err) { logger.error(err); }
    return result;
}

async function upload_image(file) {
    return (await Bot.pickFriend(Bot.uin)._preprocess(segment.image(file))).imgs[0];
}
}