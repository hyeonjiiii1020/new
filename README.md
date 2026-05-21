# KAAF Instagram Result Card Maker

대한육상연맹 실시간 결과에서 진행 중인 정선 4개 대회 결과를 불러와 1080x1080 인스타그램 카드 PNG로 저장하는 로컬 웹앱입니다.

## 로컬 실행

```bash
node server.js
```

`npm`이 있는 환경에서는 `npm start`도 같은 서버를 실행합니다.

브라우저에서 `http://localhost:5173`을 열면 됩니다.

## 동작

- 실시간 경기 목록: 각 대회 `resultType=TRM`
- 지원 대회:
  - 제80회 전국육상경기선수권대회
  - 제26회 한국 U20육상경기선수권대회
  - 제17회 한국 U18육상경기대회
  - 제28회 전국꿈나무선수선발육상경기대회
- 한 페이지 최대 7명
- 표시 순서: 순위, 성명, 소속, 기록
- 10종/8종/7종경기는 순위, 성명, 소속, 총점 표시
- DNS/DNF 및 기록 없는 선수는 기본 제외
- 조가 여러 개인 예선/준결승은 기본으로 조별 페이지 분리
- 결승은 조별 결과가 있더라도 전체 기록 기준으로 통합 랭킹 처리
- 카드 오른쪽 아래에 `한국육상매거진` 출처 표기

## 배포

이 앱은 정적 HTML만 올리면 안 되고, `server.js` Node 서버까지 같이 배포해야 합니다. Render 기준으로는 아래 순서가 가장 간단합니다.

1. 이 폴더를 GitHub 저장소로 올립니다.
2. Render에서 **New > Web Service**를 선택합니다.
3. GitHub 저장소를 연결합니다.
4. `render.yaml`을 감지하면 그대로 배포합니다.
5. 배포가 끝나면 Render가 제공하는 공개 URL을 공유하면 됩니다.

수동 입력이 필요하면 아래 값으로 설정합니다.

- Build Command: `npm install`
- Start Command: `node server.js`
- Health Check Path: `/api/health`
