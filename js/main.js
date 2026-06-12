/**
 * World Cup 2026 Vietnam - Main Application
 * Handles navigation, data loading, and page rendering.
 */
(function () {
  'use strict';

  const APP = {
    teams: [],
    matches: [],
    standings: {},
    currentPage: '',
    ready: false
  };

  // ===== Utility Functions =====
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  function getFlag(teamId) {
    if (!APP.teams.length) return '🏳️';
    const t = APP.teams.find(t => t.id === teamId);
    return t ? t.flag : '🏳️';
  }

  function getTeamName(teamId) {
    if (!APP.teams.length) return teamId;
    const t = APP.teams.find(t => t.id === teamId);
    return t ? t.name_vi : teamId;
  }

  function getTeamAttr(teamId, attr, def) {
    if (!APP.teams.length) return def;
    const t = APP.teams.find(t => t.id === teamId);
    return t ? (t[attr] ?? def) : def;
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const months = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
    return `${days[d.getDay()]}, ${d.getDate()}/${months[d.getMonth()]}`;
  }

  function formatTime(time) { return time + ' (GMT+7)'; }

  function statusClass(status) {
    if (status === 'finished') return 'finished';
    if (status === 'live') return 'live';
    return 'upcoming';
  }

  function statusText(status) {
    if (status === 'finished') return 'ĐÃ KẾT THÚC';
    if (status === 'live') return 'TRỰC TIẾP';
    return 'SẮP DIỄN RA';
  }

  // ===== Data Loading =====
  async function loadData() {
    try {
      const [teamsRes, matchesRes, standingsRes] = await Promise.all([
        fetch('data/teams.json'),
        fetch('data/matches.json'),
        fetch('data/standings.json')
      ]);

      if (!teamsRes.ok || !matchesRes.ok || !standingsRes.ok) {
        throw new Error('Failed to load data files');
      }

      const teamsData = await teamsRes.json();
      const matchesData = await matchesRes.json();
      const standingsData = await standingsRes.json();

      APP.teams = teamsData.teams || teamsData;
      APP.matches = matchesData.matches || matchesData;
      APP.standings = standingsData.standings || standingsData;
      APP.ready = true;

      return true;
    } catch (e) {
      console.error('Data loading error:', e);
      // Retry with a small delay
      return new Promise(resolve => {
        setTimeout(async () => {
          try {
            const [t, m, s] = await Promise.all([
              fetch('data/teams.json').then(r => r.json()),
              fetch('data/matches.json').then(r => r.json()),
              fetch('data/standings.json').then(r => r.json())
            ]);
            APP.teams = t.teams || t;
            APP.matches = m.matches || m;
            APP.standings = s.standings || s;
            APP.ready = true;
            resolve(true);
          } catch (e2) {
            console.error('Retry failed:', e2);
            showError('Không thể tải dữ liệu. Vui lòng làm mới trang.');
            resolve(false);
          }
        }, 500);
      });
    }
  }

  function showError(msg) {
    const main = document.querySelector('main');
    if (main) {
      main.innerHTML = `<div class="section" style="text-align:center;padding:4rem 2rem">
        <div style="font-size:3rem;margin-bottom:1rem">⚠️</div>
        <h2 style="color:var(--gold);margin-bottom:1rem">Có lỗi xảy ra</h2>
        <p style="color:var(--text-light)">${msg}</p>
      </div>`;
    }
  }

  // ===== Navigation =====
  function initNav() {
    const hamburger = $('.hamburger');
    const navLinks = $('.nav-links');
    if (hamburger && navLinks) {
      hamburger.addEventListener('click', () => {
        navLinks.classList.toggle('open');
      });
    }

    // Highlight active nav link
    const page = window.location.pathname.split('/').pop() || 'index.html';
    $$('.nav-links a').forEach(a => {
      const href = a.getAttribute('href');
      if (href === page || (page === '' && href === 'index.html')) {
        a.classList.add('active');
      }
    });
  }

  // ===== Countdown Timer =====
  function initCountdown(targetDate) {
    const containers = $$('.countdown');
    if (!containers.length) return;

    function update() {
      const now = new Date();
      const target = new Date(targetDate + 'T18:00:00-05:00'); // EST
      const diff = target - now;

      if (diff <= 0) {
        containers.forEach(c => {
          c.innerHTML = '<div class="countdown-item"><span class="num" style="font-size:1.5rem">🎉</span><span class="label">ĐÃ DIỄN RA</span></div>';
        });
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);

      containers.forEach(c => {
        c.innerHTML = `
          <div class="countdown-item"><span class="num">${String(days).padStart(2,'0')}</span><span class="label">Ngày</span></div>
          <div class="countdown-item"><span class="num">${String(hours).padStart(2,'0')}</span><span class="label">Giờ</span></div>
          <div class="countdown-item"><span class="num">${String(mins).padStart(2,'0')}</span><span class="label">Phút</span></div>
          <div class="countdown-item"><span class="num">${String(secs).padStart(2,'0')}</span><span class="label">Giây</span></div>`;
      });
    }

    update();
    setInterval(update, 1000);
  }

  // ===== Standings Rendering =====
  function renderStandings(container) {
    if (!container) return;

    const groups = Object.keys(APP.standings).sort();
    container.innerHTML = '<div class="loading">Đang tải bảng xếp hạng...</div>';

    let html = '<div class="standings-container">';
    groups.forEach(group => {
      const teams = APP.standings[group];
      if (!teams || !teams.length) return;

      html += `<div class="group-card">
        <h3>Bảng ${group}</h3>
        <table class="standings-table">
          <thead><tr>
            <th></th><th class="team-col">Đội</th><th>ST</th><th>T</th><th>H</th><th>B</th><th>BT</th><th>BB</th><th>HS</th><th>Đ</th><th>F</th>
          </tr></thead>
          <tbody>`;

      teams.forEach((t, i) => {
        const isTopTwo = i < 2;
        html += `<tr class="${isTopTwo ? 'top-two' : ''}">
          <td class="pos">${i + 1}</td>
          <td><div class="team-cell"><span class="flag">${getFlag(t.team_id)}</span><span class="name">${getTeamName(t.team_id)}</span></div></td>
          <td>${t.p}</td>
          <td>${t.w}</td>
          <td>${t.d}</td>
          <td>${t.l}</td>
          <td>${t.gf}</td>
          <td>${t.ga}</td>
          <td>${t.gd > 0 ? '+' : ''}${t.gd}</td>
          <td class="pts">${t.pts}</td>
          <td><div class="form-indicator">${renderForm(t.form)}</div></td>
        </tr>`;
      });

      html += `</tbody></table></div>`;
    });
    html += '</div>';

    // Add legend
    html += `<div style="margin-top:2rem;padding:1rem;background:var(--card-bg);border-radius:var(--radius);border:1px solid var(--card-border)">
      <p style="color:var(--text-light);font-size:0.85rem">
        <span style="color:var(--green)">●</span> Hai đội đứng đầu mỗi bảng + 
        <span style="color:var(--blue)">●</span> 8 đội xếp thứ ba có thành tích tốt nhất 
        → Vòng 32 đội
      </p>
    </div>`;

    container.innerHTML = html;
  }

  function renderForm(form) {
    if (!form || !form.length) return '<span style="color:var(--text-light);font-size:0.7rem">-</span>';
    return form.map(r => `<span class="form-dot ${r.toLowerCase()}">${r}</span>`).join('');
  }

  // ===== Match Schedule =====
  function renderMatches(container, filter) {
    if (!container) return;
    container.innerHTML = '<div class="loading">Đang tải lịch thi đấu...</div>';

    let matches = [...APP.matches];
    if (filter && filter !== 'all') {
      if (['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].includes(filter)) {
        matches = matches.filter(m => m.group === filter);
      } else if (filter === 'finished') {
        matches = matches.filter(m => m.status === 'finished');
      } else if (filter === 'upcoming') {
        matches = matches.filter(m => m.status === 'upcoming');
      } else if (filter === 'knockout') {
        matches = matches.filter(m => m.stage !== 'group');
      }
    }

    // Sort by date
    matches.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

    if (!matches.length) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-light);padding:2rem">Không có trận đấu nào.</p>';
      return;
    }

    let html = '';
    let currentDate = '';

    matches.forEach(m => {
      if (m.date !== currentDate) {
        currentDate = m.date;
        html += `<div style="margin:1.5rem 0 0.8rem;"><h3 style="color:var(--gold);font-size:1rem">${formatDate(m.date)}</h3></div>`;
      }

      const homeName = m.home_team_id ? getTeamName(m.home_team_id) : 'TBD';
      const awayName = m.away_team_id ? getTeamName(m.away_team_id) : 'TBD';
      const homeFlag = m.home_team_id ? getFlag(m.home_team_id) : '❓';
      const awayFlag = m.away_team_id ? getFlag(m.away_team_id) : '❓';

      let scoreDisplay = '<span class="vs">vs</span>';
      if (m.status === 'finished' && m.home_score !== null) {
        scoreDisplay = `${m.home_score} - ${m.away_score}`;
      }

      const analysisLink = m.home_team_id && m.away_team_id
        ? `<a href="phan-tich-tran-dau.html?match=${m.id}" class="match-link">📊 Phân tích</a>`
        : '';

      html += `<div class="match-card">
        <div class="match-header">
          <span class="match-group-badge">Bảng ${m.group}</span>
          <span class="match-status ${statusClass(m.status)}">${statusText(m.status)}</span>
        </div>
        <div class="match-teams">
          <div class="team-display">
            <span class="flag">${homeFlag}</span>
            <span class="name">${homeName}</span>
          </div>
          <div class="match-score">${scoreDisplay}</div>
          <div class="team-display away">
            <span class="flag">${awayFlag}</span>
            <span class="name">${awayName}</span>
          </div>
        </div>
        <div class="match-info">
          <span>📅 ${formatDate(m.date)} ${formatTime(m.time)}</span>
          <span class="match-venue">🏟️ ${m.venue}, ${m.city}</span>
          ${analysisLink}
        </div>
      </div>`;
    });

    container.innerHTML = html;
  }

  // ===== Match Analysis =====
  function renderAnalysis(container, matchId) {
    if (!container) return;

    // If no matchId provided, show selector only
    if (!matchId) {
      container.innerHTML = renderMatchSelector('');
      return;
    }

    const match = APP.matches.find(m => m.id === matchId);
    if (!match || !match.home_team_id || !match.away_team_id) {
      container.innerHTML = `<p style="text-align:center;color:var(--text-light);padding:2rem">Không tìm thấy dữ liệu trận đấu.</p>`;
      return;
    }

    const analysis = WC2026_Predictions.analyzeMatch(match, APP.teams);
    if (!analysis) {
      container.innerHTML = `<p style="text-align:center;color:var(--text-light);padding:2rem">Không thể phân tích trận đấu.</p>`;
      return;
    }

    const wt = analysis.winProb;

    container.innerHTML = `
      ${renderMatchSelector(matchId)}

      <div class="analysis-dashboard">
        <!-- Win Probability -->
        <div class="analysis-card">
          <h3>📊 Tỉ lệ thắng</h3>
          <div class="prob-display">
            <div class="prob-team">
              <div class="flag">${getFlag(match.home_team_id)}</div>
              <div class="name" style="color:var(--blue)">${getTeamName(match.home_team_id)}</div>
              <div style="font-size:1.5rem;font-weight:800;color:var(--blue);margin-top:4px">${wt.homeWin}%</div>
            </div>
            <div class="prob-bar-container">
              <div class="progress-bar" style="height:30px;border-radius:15px">
                <div class="progress-fill home" style="width:${wt.homeWin}%"></div>
              </div>
              <div style="display:flex;justify-content:center;margin:6px 0">
                <span style="font-size:1.2rem;font-weight:700;color:var(--yellow)">${wt.draw}%</span>
                <span style="color:var(--text-light);font-size:0.8rem;margin-left:4px">Hòa</span>
              </div>
              <div class="progress-bar" style="height:30px;border-radius:15px;transform:scaleX(-1)">
                <div class="progress-fill away" style="width:${wt.awayWin}%"></div>
              </div>
            </div>
            <div class="prob-team">
              <div class="flag">${getFlag(match.away_team_id)}</div>
              <div class="name" style="color:var(--red)">${getTeamName(match.away_team_id)}</div>
              <div style="font-size:1.5rem;font-weight:800;color:var(--red);margin-top:4px">${wt.awayWin}%</div>
            </div>
          </div>
        </div>

        <!-- Score Prediction -->
        <div class="analysis-card">
          <h3>⚽ Dự đoán tỉ số</h3>
          <div style="text-align:center;padding:1rem">
            <div style="display:flex;align-items:center;justify-content:center;gap:2rem;flex-wrap:wrap">
              <div style="text-align:center">
                <div style="font-size:2.5rem">${getFlag(match.home_team_id)}</div>
                <div style="font-weight:600;color:var(--text-bright)">${getTeamName(match.home_team_id)}</div>
              </div>
              <div style="font-size:3.5rem;font-weight:800;color:var(--gold)">${analysis.score.home} : ${analysis.score.away}</div>
              <div style="text-align:center">
                <div style="font-size:2.5rem">${getFlag(match.away_team_id)}</div>
                <div style="font-weight:600;color:var(--text-bright)">${getTeamName(match.away_team_id)}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Additional Predictions -->
        <div class="analysis-grid">
          <div class="analysis-card">
            <h3>🏳️ Tổng phạt góc</h3>
            <div style="text-align:center;padding:1rem">
              <div class="big-num" style="font-size:3rem;font-weight:800;color:var(--gold)">${analysis.corners}</div>
              <div style="color:var(--text-light)">quả phạt góc dự kiến</div>
            </div>
          </div>
          <div class="analysis-card">
            <h3>🟨 Tổng thẻ</h3>
            <div style="text-align:center;padding:1rem">
              <div class="big-num" style="font-size:3rem;font-weight:800;color:var(--gold)">${analysis.cards}</div>
              <div style="color:var(--text-light)">thẻ dự kiến (vàng + đỏ)</div>
            </div>
          </div>
          <div class="analysis-card">
            <h3>⭐ Cầu thủ ghi bàn</h3>
            <div style="text-align:center;padding:1rem">
              <div style="font-size:2rem;font-weight:700;color:var(--text-bright)">${analysis.predictedScorer}</div>
              <div style="color:var(--text-light);margin-top:4px">dự đoán ghi bàn đầu tiên</div>
            </div>
          </div>
          <div class="analysis-card">
            <h3>📊 Chênh lệch FIFA Ranking</h3>
            <div style="text-align:center;padding:1rem">
              <div style="display:flex;justify-content:center;gap:1.5rem">
                <div><span style="font-size:0.8rem;color:var(--text-light)">${getTeamName(match.home_team_id)}</span><br><span style="font-size:1.5rem;font-weight:800;color:var(--blue)">${analysis.homeTeam.fifa_ranking}</span></div>
                <div style="color:var(--text-light);display:flex;align-items:center">vs</div>
                <div><span style="font-size:0.8rem;color:var(--text-light)">${getTeamName(match.away_team_id)}</span><br><span style="font-size:1.5rem;font-weight:800;color:var(--red)">${analysis.awayTeam.fifa_ranking}</span></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Analysis Text -->
        <div class="analysis-card">
          <h3>📝 Nhận định trận đấu</h3>
          <div style="padding:0.5rem 0">
            <p style="color:var(--text-light);line-height:1.8">${analysis.analysis.summary}</p>
            <p style="color:var(--text-light);line-height:1.8;margin-top:0.5rem">${analysis.analysis.details}</p>
            <div style="margin-top:1rem;padding:1rem;background:rgba(255,215,0,0.05);border-radius:8px;border:1px solid rgba(255,215,0,0.1)">
              <p style="color:var(--gold);font-weight:600;margin-bottom:0.5rem">🔍 Phân tích chuyên sâu:</p>
              <ul style="color:var(--text-light);font-size:0.9rem;padding-left:1.2rem;line-height:2">
                <li><strong style="color:var(--text-bright)">${analysis.homeTeam.name_vi}:</strong> ${analysis.homeTeam.strengths_vi.join(', ')}</li>
                <li><strong style="color:var(--text-bright)">${analysis.awayTeam.name_vi}:</strong> ${analysis.awayTeam.strengths_vi.join(', ')}</li>
                <li><strong style="color:var(--gold)">Dự đoán:</strong> ${analysis.predictedScorer} sẽ ghi bàn.</li>
                <li><strong style="color:var(--gold)">Phạt góc:</strong> Khoảng ${analysis.corners} quả.</li>
                <li><strong style="color:var(--gold)">Thẻ phạt:</strong> Khoảng ${analysis.cards} thẻ.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>`;

    // Handle match selector change
    const selector = $('#match-selector');
    if (selector) {
      selector.addEventListener('change', () => {
        if (selector.value) {
          window.location.href = `phan-tich-tran-dau.html?match=${selector.value}`;
        }
      });
    }
  }

  function renderMatchSelector(selectedId) {
    const groupMatches = APP.matches.filter(m => m.home_team_id && m.away_team_id);
    groupMatches.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

    let options = '<option value="">-- Chọn trận đấu --</option>';
    let currentDate = '';
    groupMatches.forEach(m => {
      const label = `${getTeamName(m.home_team_id)} vs ${getTeamName(m.away_team_id)} (${formatDate(m.date)})`;
      const prefix = m.date !== currentDate ? `───── ${formatDate(m.date)} ─────` : '';
      if (m.date !== currentDate) {
        currentDate = m.date;
        options += `<option disabled>${prefix}</option>`;
      }
      options += `<option value="${m.id}" ${m.id === selectedId ? 'selected' : ''}>${label}</option>`;
    });

    return `<select id="match-selector" class="match-selector">${options}</select>`;
  }

  // ===== Featured Matches (Homepage) =====
  function renderFeaturedMatches(container) {
    if (!container) return;

    // Show recent finished matches + upcoming highlights
    const finished = APP.matches.filter(m => m.status === 'finished').slice(-4);
    const upcoming = APP.matches.filter(m => m.status === 'upcoming' && m.home_team_id).slice(0, 6);

    let html = '<div class="featured-matches">';

    finished.forEach(m => {
      html += matchToCard(m);
    });

    if (finished.length === 0) {
      // Show first 4 upcoming if no finished matches
      upcoming.slice(0, 4).forEach(m => {
        html += matchToCard(m);
      });
    } else {
      upcoming.slice(0, 2).forEach(m => {
        html += matchToCard(m);
      });
    }

    html += '</div>';
    container.innerHTML = html;
  }

  function matchToCard(m) {
    const homeName = m.home_team_id ? getTeamName(m.home_team_id) : 'TBD';
    const awayName = m.away_team_id ? getTeamName(m.away_team_id) : 'TBD';
    const homeFlag = m.home_team_id ? getFlag(m.home_team_id) : '❓';
    const awayFlag = m.away_team_id ? getFlag(m.away_team_id) : '❓';

    let scoreDisplay = '<span class="vs">vs</span>';
    if (m.status === 'finished' && m.home_score !== null) {
      scoreDisplay = `${m.home_score} - ${m.away_score}`;
    }

    const analysisLink = m.home_team_id && m.away_team_id
      ? `<a href="phan-tich-tran-dau.html?match=${m.id}" class="match-link">📊 Phân tích</a>`
      : '';

    return `<div class="match-card">
      <div class="match-header">
        <span class="match-group-badge">Bảng ${m.group}</span>
        <span class="match-status ${statusClass(m.status)}">${statusText(m.status)}</span>
      </div>
      <div class="match-teams">
        <div class="team-display">
          <span class="flag">${homeFlag}</span>
          <span class="name">${homeName}</span>
        </div>
        <div class="match-score">${scoreDisplay}</div>
        <div class="team-display away">
          <span class="flag">${awayFlag}</span>
          <span class="name">${awayName}</span>
        </div>
      </div>
      <div class="match-info">
        <span>📅 ${formatDate(m.date)} ${formatTime(m.time)}</span>
        <span class="match-venue">🏟️ ${m.venue}</span>
        ${analysisLink}
      </div>
    </div>`;
  }

  // ===== Results Ticker =====
  function initTicker() {
    const ticker = $('.ticker-track');
    if (!ticker) return;

    const finished = APP.matches.filter(m => m.status === 'finished');
    if (!finished.length) {
      ticker.innerHTML = '<span class="ticker-item">🏆 World Cup 2026 đang diễn ra sôi động! Cập nhật kết quả liên tục.</span>';
      return;
    }

    let items = finished.map(m =>
      `${getFlag(m.home_team_id)} ${getTeamName(m.home_team_id)} ${m.home_score}-${m.away_score} ${getTeamName(m.away_team_id)} ${getFlag(m.away_team_id)}`
    );

    // Duplicate for seamless scroll
    ticker.innerHTML = [...items, ...items].map(t => `<span class="ticker-item">• ${t}</span>`).join(' ');
  }

  // ===== Predictions Page =====
  function renderPredictions(container) {
    if (!container) return;
    container.innerHTML = '<div class="loading">Đang tải dự đoán...</div>';

    // Predict group winners
    const predictions = WC2026_Predictions.predictGroupStandings(APP.standings, APP.teams);

    let html = `
      <div class="card" style="margin-bottom:2rem">
        <h3 style="color:var(--gold);margin-bottom:1rem">🏆 Dự đoán đội vô địch</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem">
          <div class="prediction-card">
            <div class="big-num" style="font-size:1.5rem">🇦🇷</div>
            <div style="font-weight:700;color:var(--text-bright);margin-top:4px">Argentina</div>
            <div style="color:var(--gold);font-weight:700;font-size:1.3rem">22%</div>
            <div class="label">ĐKVĐ, đội số 1 thế giới</div>
          </div>
          <div class="prediction-card">
            <div class="big-num" style="font-size:1.5rem">🇫🇷</div>
            <div style="font-weight:700;color:var(--text-bright);margin-top:4px">Pháp</div>
            <div style="color:var(--gold);font-weight:700;font-size:1.3rem">18%</div>
            <div class="label">Á quân 2022, đội hình mạnh</div>
          </div>
          <div class="prediction-card">
            <div class="big-num" style="font-size:1.5rem">🇧🇷</div>
            <div style="font-weight:700;color:var(--text-bright);margin-top:4px">Brazil</div>
            <div style="color:var(--gold);font-weight:700;font-size:1.3rem">15%</div>
            <div class="label">Luôn là ứng cử viên</div>
          </div>
          <div class="prediction-card">
            <div class="big-num" style="font-size:1.5rem">🏴󠁧󠁢󠁥󠁮󠁧󠁿</div>
            <div style="font-weight:700;color:var(--text-bright);margin-top:4px">Anh</div>
            <div style="color:var(--gold);font-weight:700;font-size:1.3rem">12%</div>
            <div class="label">Đội hình trẻ, nhiều tài năng</div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:2rem">
        <h3 style="color:var(--gold);margin-bottom:1rem">⚽ Vua phá lưới dự đoán</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem">
          <div class="prediction-card">
            <div style="font-size:2rem;font-weight:800;color:var(--gold)">1</div>
            <div style="font-weight:700;color:var(--text-bright);margin-top:4px">Kylian Mbappé 🇫🇷</div>
            <div style="color:var(--text-light)">Pháp</div>
          </div>
          <div class="prediction-card">
            <div style="font-size:2rem;font-weight:800;color:var(--gold)">2</div>
            <div style="font-weight:700;color:var(--text-bright);margin-top:4px">Erling Haaland 🇳🇴</div>
            <div style="color:var(--text-light)">Na Uy</div>
          </div>
          <div class="prediction-card">
            <div style="font-size:2rem;font-weight:800;color:var(--gold)">3</div>
            <div style="font-weight:700;color:var(--text-bright);margin-top:4px">Harry Kane 🏴󠁧󠁢󠁥󠁮󠁧󠁿</div>
            <div style="color:var(--text-light)">Anh</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3 style="color:var(--gold);margin-bottom:1rem">📊 Dự đoán bảng đấu</h3>
        <div class="standings-container">`;

    Object.keys(predictions).sort().forEach(group => {
      const teams = predictions[group];
      html += `<div class="group-card">
        <h3>Bảng ${group}</h3>
        <table class="standings-table">
          <thead><tr><th></th><th class="team-col">Đội</th><th>Đ</th></tr></thead>
          <tbody>
            ${teams.map((t, i) => `
              <tr class="${i < 2 ? 'top-two' : ''}">
                <td class="pos">${i + 1}</td>
                <td><div class="team-cell"><span class="flag">${getFlag(t.team_id)}</span><span class="name">${getTeamName(t.team_id)}</span></div></td>
                <td class="pts">${t.pts}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
    });

    html += `</div></div>`;
    container.innerHTML = html;
  }

  // ===== Update Button =====
  function initUpdateButton() {
    const btn = $('#update-btn');
    if (!btn) return;

    // Load lineups data if available
    async function loadLineups() {
      try {
        const res = await fetch('data/lineups.json');
        if (res.ok) {
          APP.lineups = await res.json();
        }
      } catch (e) { /* no lineups yet */ }
    }
    loadLineups();

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.innerHTML = '⏳ Đang cập nhật...';
      btn.classList.remove('btn-gold');
      btn.classList.add('btn-outline');

      try {
        // Try to trigger GitHub Actions workflow_dispatch
        const resp = await fetch(
          'https://api.github.com/repos/zdapricorn/worldcup2026/actions/workflows/update-data.yml/dispatches',
          {
            method: 'POST',
            headers: {
              'Accept': 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ref: 'main', inputs: { reason: 'manual' } })
          }
        );

        if (resp.ok || resp.status === 204) {
          btn.innerHTML = '✅ Đã kích hoạt cập nhật!';
          // Show status message
          const status = $('#update-status');
          if (status) {
            status.innerHTML = '⏳ Dữ liệu đang được cập nhật (1-2 phút)...';
            status.style.display = 'block';
          }
        } else {
          // Fallback: reload data
          btn.innerHTML = '🔄 Đang tải lại...';
          await loadData();
          await reloadCurrentPage();
          btn.innerHTML = '✅ Đã cập nhật!';
        }
      } catch (e) {
        // Offline fallback - just reload local data
        btn.innerHTML = '🔄 Đang tải lại dữ liệu...';
        await loadData();
        await reloadCurrentPage();
        btn.innerHTML = '✅ Đã cập nhật!';
      }

      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = '🔄 Cập nhật dữ liệu';
        btn.classList.remove('btn-outline');
        btn.classList.add('btn-gold');
        const status = $('#update-status');
        if (status) status.style.display = 'none';
      }, 5000);
    });
  }

  // ===== Reload Current Page =====
  async function reloadCurrentPage() {
    const standingsC = $('#standings-container');
    if (standingsC) renderStandings(standingsC);

    const matchesC = $('#matches-container');
    if (matchesC) {
      const activeFilter = $('.filter-btn.active');
      renderMatches(matchesC, activeFilter ? activeFilter.dataset.filter : 'all');
    }

    const featuredC = $('#featured-matches');
    if (featuredC) renderFeaturedMatches(featuredC);

    const ticker = $('.ticker-track');
    if (ticker) initTicker();

    const analysisC = $('#analysis-container');
    if (analysisC) {
      const params = new URLSearchParams(window.location.search);
      renderAnalysis(analysisC, params.get('match'));
    }
  }

  // ===== Lineup/Formation Display =====
  function renderLineup(container, matchId, lineupsData) {
    if (!container || !matchId) return;

    const lineup = lineupsData?.[matchId];
    if (!lineup) {
      container.innerHTML = '<p style="color:var(--text-light);text-align:center;padding:1rem">Chưa có dữ liệu đội hình</p>';
      return;
    }

    const home = lineup.lineups.home;
    const away = lineup.lineups.away;
    if (!home.starting_xi?.length || !away.starting_xi?.length) {
      container.innerHTML = '<p style="color:var(--text-light);text-align:center;padding:1rem">Đội hình chưa được công bố</p>';
      return;
    }

    // Render formation visualization
    function formationGrid(players, formation, side) {
      if (!players?.length) return '';
      const formationName = formation || '4-4-2';
      const rows = formationName.split('-').map(Number);
      let playerIdx = 0;

      // GK always last row
      const gk = players.find(p => p.pos === 'G') || players[players.length - 1];
      const fieldPlayers = players.filter(p => p.pos !== 'G');

      let html = `<div class="formation" style="position:relative;width:100%;max-width:300px;margin:0 auto">`;
      html += `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:80%;height:60%;border:2px solid rgba(255,215,0,0.2);border-radius:50%;pointer-events:none"></div>`;
      html += `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:60%;height:40%;border:2px solid rgba(255,215,0,0.15);border-radius:50%;pointer-events:none"></div>`;

      // GK
      html += `<div style="position:absolute;bottom:2%;left:50%;transform:translateX(-50%);text-align:center">
        <div style="width:36px;height:36px;border-radius:50%;background:var(--gold);color:var(--dark);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.75rem;margin:0 auto">${gk.number || '?'}</div>
        <div style="font-size:0.6rem;color:var(--text-bright);margin-top:2px;white-space:nowrap">${gk.name?.split(' ').pop() || 'GK'}</div>
      </div>`;

      // Field players by formation row
      let topPct = 12;
      for (const count of rows) {
        const rowPlayers = fieldPlayers.slice(playerIdx, playerIdx + count);
        playerIdx += count;
        const gap = 100 / (count + 1);

        html += `<div style="position:absolute;top:${topPct}%;left:0;right:0;display:flex;justify-content:space-around;padding:0 10px">`;
        rowPlayers.forEach(p => {
          const shortName = p.name?.split(' ').pop() || '?';
          html += `<div style="text-align:center">
            <div style="width:32px;height:32px;border-radius:50%;background:var(--card-bg);border:1px solid var(--card-border);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.7rem;color:var(--text-bright);margin:0 auto">${p.number || '?'}</div>
            <div style="font-size:0.55rem;color:var(--text-light);margin-top:1px;white-space:nowrap">${shortName}</div>
          </div>`;
        });
        html += `</div>`;
        topPct += 12;
      }

      html += '</div>';
      $('.ticker').remove();
      $('.ticker-track').remove();
      return html;
    }

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem">
        <div class="analysis-card">
          <h3 style="font-size:0.9rem;margin-bottom:0.5rem">${lineup.home_team}</h3>
          <p style="font-size:0.75rem;color:var(--text-light);margin-bottom:0.5rem">Đội hình: ${home.formation || 'N/A'}</p>
          ${formationGrid(home.starting_xi, home.formation, 'home')}
        </div>
        <div class="analysis-card">
          <h3 style="font-size:0.9rem;margin-bottom:0.5rem">${lineup.away_team}</h3>
          <p style="font-size:0.75rem;color:var(--text-light);margin-bottom:0.5rem">Đội hình: ${away.formation || 'N/A'}</p>
          ${formationGrid(away.starting_xi, away.formation, 'away')}
        </div>
      </div>
      <div style="margin-top:1rem">
        <h3 style="font-size:0.85rem;color:var(--gold);margin-bottom:0.5rem">🔄 Dự bị</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
          <div>
            ${(home.substitutes || []).map(p => `<span style="font-size:0.75rem;color:var(--text-light);margin-right:0.5rem">${p.number}. ${p.name}</span>`).join('')}
          </div>
          <div>
            ${(away.substitutes || []).map(p => `<span style="font-size:0.75rem;color:var(--text-light);margin-right:0.5rem">${p.number}. ${p.name}</span>`).join('')}
          </div>
        </div>
      </div>`;
  }

  // ===== Live Match Status =====
  function initAutoRefresh() {
    // Auto-refresh match data every 60 seconds
    setInterval(async () => {
      const anyLive = APP.matches?.some(m => m.status === 'live');
      if (anyLive) {
        try {
          const res = await fetch('data/matches.json?t=' + Date.now());
          if (res.ok) {
            const data = await res.json();
            const newMatches = data.matches || data;
            // Check if scores changed
            let changed = false;
            newMatches.forEach(nm => {
              const old = APP.matches?.find(m => m.id === nm.id);
              if (old && nm.status === 'live' &&
                  (old.home_score !== nm.home_score || old.away_score !== nm.away_score)) {
                changed = true;
              }
            });
            if (changed) {
              APP.matches = newMatches;
              await reloadCurrentPage();
            }
          }
        } catch (e) { /* skip */ }
      }
    }, 60000);
  }

  // ===== Enhanced Initialization =====
  async function init() {
    const loaded = await loadData();
    if (!loaded) return;

    initNav();
    initUpdateButton();
    initAutoRefresh();

    // Load lineups
    try {
      const res = await fetch('data/lineups.json');
      if (res.ok) APP.lineups = await res.json();
    } catch (e) { APP.lineups = {}; }

    // Determine current page
    const path = window.location.pathname.split('/').pop() || 'index.html';

    // Countdown
    initCountdown('2026-07-19');

    // Ticker
    initTicker();

    // Page-specific rendering
    const standingsContainer = $('#standings-container');
    if (standingsContainer) {
      renderStandings(standingsContainer);
    }

    const matchesContainer = $('#matches-container');
    if (matchesContainer) {
      renderMatches(matchesContainer, 'all');
      $$('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          $$('.filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          renderMatches(matchesContainer, btn.dataset.filter || 'all');
        });
      });
    }

    const featuredContainer = $('#featured-matches');
    if (featuredContainer) {
      renderFeaturedMatches(featuredContainer);
    }

    const analysisContainer = $('#analysis-container');
    if (analysisContainer) {
      const params = new URLSearchParams(window.location.search);
      const matchId = params.get('match');
      renderAnalysis(analysisContainer, matchId);

      // Check for lineup display
      const lineupContainer = $('#lineup-container');
      if (lineupContainer && matchId && APP.lineups) {
        renderLineup(lineupContainer, matchId, APP.lineups);
      }
    }

    const predictionsContainer = $('#predictions-container');
    if (predictionsContainer) {
      renderPredictions(predictionsContainer);
    }
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
