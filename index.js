const express = require('express');
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const bodyParser = require('body-parser');
const axs = require('axios');
const axios = axs.create({
    timeout: 20000,
});
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const BANK_LIST = ['BCA', 'DANA', 'BRI', 'MANDIRI', 'BNI'];

const AVAILABLE_DOC_LIST_BANKS = [
    'BCA',
    'bcaMedium',
    'bcaVip',
    'DANA',
    'danaMedium',
    'danaVip',
    'CIMB',
    'MANDIRI',
    'BNI',
    'BRI',
];

const authorizeSpreadSheet = async (id, creds, sheetIdx) => {
    const jwt = new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive.file',
        ],
    });

    const doc = new GoogleSpreadsheet(id, jwt);

    await doc.loadInfo();

    return doc.sheetsByIndex[sheetIdx];
};

const getSpreadsheetData = async (id, creds, sheetIdx, offset = 11) => {
    const sheet = await authorizeSpreadSheet(id, creds, sheetIdx);

    return await sheet.getRows({
        offset: offset,
    });
};

app.get('/', async ({ query: { id, bank, index, wl } }, response) => {
    if (!id || !bank || !BANK_LIST.includes(bank.toUpperCase()) || !index)
        return response.send('Invalid ID/BANK/INDEX/WL');

    try {
        const creds = require(`./wl/${wl}/keys_${bank}.json`);

        const data = await getSpreadsheetData(
            id,
            creds,
            parseInt(index) - 1,
            10
        );

        const pendingForms = data
            .map((row) => {
                return {
                    id: row.toObject().id,
                    name: row.toObject().name
                        ? row
                              .toObject()
                              .name.trim()
                              .replace(/\s/g, '')
                              .toUpperCase()
                        : undefined,
                    coin: row.toObject().coin
                        ? parseInt(
                              row.toObject().coin.trim().replace(/\D/g, '')
                          )
                        : undefined,
                    row: row._rowNumber,
                    bank: bank.toUpperCase(),
                };
            })
            .filter(
                (row) =>
                    row.id === '' &&
                    row.name &&
                    row.name.length !== 0 &&
                    row.coin &&
                    row.coin >= 20
            )
            .sort((a, b) => b.name.length - a.name.length);

        response.json(pendingForms);
    } catch (error) {
        if (error.response) {
            console.error(
                `${wl} | ${bank} | ${error.response.data.error.status}`
            );
            console.error(
                `${error.response.data.error.code} - ${error.response.data.error.message}`
            );
        } else {
            console.error(`${wl} | ${bank} | ${error.message}`);
        }

        response.json([]);
    }
});

app.get('/:id/:wl', async ({ params: { id, wl } }, response) => {
    if (!id) return response.send('Invalid ID');

    const listIDs = {};
    const listIndex = {};

    try {
        const creds = require(`./wl/${wl}/keys.json`);

        const data = await getSpreadsheetData(id, creds, 0, 0);

        for (const [idx, bank] of AVAILABLE_DOC_LIST_BANKS.entries()) {
            listIDs[bank] = data[idx].toObject().ID || null;
            listIndex[bank] = data[idx].toObject().SheetIndex || null;
        }

        response.send({ listIDs, listIndex });
    } catch (error) {
        if (error.response) {
            console.error(`${wl} | ${error.response.data.error.status}`);
            console.error(
                `${error.response.data.error.code} - ${error.response.data.error.message}`
            );
        } else {
            console.error(`${wl} | ${error.message}`);
        }

        for (const bank of AVAILABLE_DOC_LIST_BANKS) {
            listIDs[bank] = null;
            listIndex[bank] = null;
        }

        response.send({ listIDs, listIndex });
    }
});

app.post('/', async ({ body: { docsId, bank, data, index, wl } }, response) => {
    if (!bank || !index || !docsId || !BANK_LIST.includes(bank.toUpperCase()))
        return response.send('Invalid BANK/INDEX/ID');

    try {
        const creds = require(`./wl/${wl}/keys_${bank}.json`);

        const sheet = await authorizeSpreadSheet(
            docsId,
            creds,
            parseInt(index) - 1
        );

        const sortedList = data.sort((a, b) => a.row - b.row);

        await sheet.loadCells(
            `C${sortedList[0].row}:C${sortedList[sortedList.length - 1].row}`
        );

        const approved = sortedList
            .map((pendingForm) => {
                const docCell = sheet.getCellByA1(`C${pendingForm.row}`);
                if (docCell.value == null)
                    return (docCell.value = pendingForm.username);
                else return undefined;
            })
            .filter((userId) => userId != null);

        await sheet.saveUpdatedCells();

        response.send(approved);
    } catch (error) {
        if (error.response) {
            console.error(
                `${wl} | ${bank} | ${error.response.data.error.status}`
            );
            console.error(
                `${error.response.data.error.code} - ${error.response.data.error.message}`
            );
        } else {
            console.error(`${wl} | ${bank} | ${error.message}`);
        }

        response.send([]);
    }
});

const getPendingForms = async () => {
    const host = process.env.HOST_URL;
    const token = process.env.TOKEN;

    try {
        const {
            data: { data },
        } = await axios.get(`${host}/sse/wl/init?dp=true`, {
            headers: {
                Authorization: token,
            },
        });

        return data.data.deposits.map((d) => {
            return {
                id: d.id,
                username: d.player.username,
                name: d.player_account_name.trim().replace(/\s/g, ''),
                bank: d.company_bank.name,
                coin: d.amount,
            };
        });
    } catch (error) {
        console.log(error);
        return [];
    }
};

const getListDocs = async () => {
    const response = await axios.get(
        'http://localhost:3000/10teJMgm80dHz28jNxlYVBbMURsrO8js6uXn52Cw8jqU/angkasa338'
    );

    return response.data;
};

const getPendingDocs = async () => {
    const { listIDs, listIndex } = await getListDocs();

    const promises = [];

    promises.push(
        axios
            .get(
                `http://localhost:3000?wl=angkasa338&id=${listIDs.BCA}&index=${
                    listIndex.BCA
                }&bank=${'BCA'}`
            )
            .then((data) => {
                return data.data;
            })
    );

    promises.push(
        axios
            .get(
                `http://localhost:3000?wl=angkasa338&id=${listIDs.DANA}&index=${
                    listIndex.DANA
                }&bank=${'DANA'}`
            )
            .then((data) => {
                return data.data;
            })
    );

    promises.push(
        axios
            .get(
                `http://localhost:3000?wl=angkasa338&id=${
                    listIDs.MANDIRI
                }&index=${listIndex.MANDIRI}&bank=${'MANDIRI'}`
            )
            .then((data) => {
                return data.data;
            })
    );

    promises.push(
        axios
            .get(
                `http://localhost:3000?wl=angkasa338&id=${listIDs.BNI}&index=${
                    listIndex.BNI
                }&bank=${'BNI'}`
            )
            .then((data) => {
                return data.data;
            })
    );

    promises.push(
        axios
            .get(
                `http://localhost:3000?wl=angkasa338&id=${listIDs.BRI}&index=${
                    listIndex.BRI
                }&bank=${'BRI'}`
            )
            .then((data) => {
                return data.data;
            })
    );

    const pendingDocs = [];
    await Promise.all(promises).then((values) => {
        values = values.sort((a, b) => a.name > b.name);
        values.forEach((v) => pendingDocs.push(...v));
    });

    return { pendingDocs, docsInfo: { listIDs, listIndex } };
};

const approveDocs = async (docsId, index, bank, wl, data) => {
    return axios.post(`http://localhost:3000`, {
        docsId,
        bank,
        data,
        index,
        wl,
    });
};

const changeStatusPanel = async (data, status) => {
    const host = process.env.HOST_URL;
    const token = process.env.TOKEN;

    const requestData = data.map((d) => {
        return {
            id: d.id,
            agent_note: null,
            status,
        };
    });

    try {
        const data = await axios.post(
            `${host}/deposit/auto-approval`,
            requestData,
            {
                headers: {
                    Authorization: token,
                },
            }
        );
    } catch (error) {
        console.log(error);
        return 'error';
    }
};

const main = async () => {
    try {
        const { pendingDocs, docsInfo } = await getPendingDocs();

        if (pendingDocs.length == 0) await main();

        const pendingForms = await getPendingForms();

        for await (bank of BANK_LIST) {
            const pendingBank = pendingDocs.filter((p) => p.bank == bank);
            const pendingPanel = pendingForms.filter((p) => p.bank == bank);

            if (pendingBank.length == 0) continue;
            if (pendingPanel.length == 0) continue;

            const selectedIds = [];
            const toBeApprove = [];

            pendingBank.forEach(({ name, coin, row }) => {
                pendingPanel.forEach((pp) => {
                    if (
                        pp.name.indexOf(name) != -1 &&
                        pp.coin == coin &&
                        pp.bank == bank &&
                        !selectedIds.includes(pp.id)
                    ) {
                        toBeApprove.push({
                            id: pp.id,
                            username: pp.username,
                            bank,
                            row,
                        });
                        selectedIds.push(pp.id);
                    }
                });
            });

            if (toBeApprove.length != 0) {
                const approveDocsResponse = await approveDocs(
                    docsInfo.listIDs[bank],
                    docsInfo.listIndex[bank],
                    bank,
                    'angkasa338',
                    toBeApprove
                );

                if (approveDocsResponse.status == 200) {
                    const approvePanelResponse = await changeStatusPanel(
                        toBeApprove,
                        2
                    );

                    console.log('--------------------');
                    console.log(bank);
                    console.log(toBeApprove.map((d) => d.username));
                }
            }
        }
    } catch (error) {
        console.log(error);
    }
    await main();
};

const port = process.env.APP_PORT;
app.listen(port, async () => {
    console.log(`Server started on ${port}`);
    // await getListDocs();
    // await getPendingForms();
    await main();
});
