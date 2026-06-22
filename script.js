const apiKey = ''; // 若不使用 ExchangeRate-API，可留空，將改用 exchangerate.host
const exchangeApiBase = 'https://v6.exchangerate-api.com/v6';
const fallbackApiBase = 'https://open.er-api.com/v6/latest'; // 免費 fallback API，可直接查詢指定幣別匯率
const gasEndpoint = 'https://script.google.com/macros/s/AKfycbyuz7bZtomb_QO0XL1v3usj3H3vJ7hhDa41LTX90pzWLpzI9Rp9ySdYNclZJbD-3ZWM/exec';

const categoryColors = {
  美食: '#f97316',
  交通: '#2563eb',
  住宿: '#10b981',
  其他: '#8b5cf6'
};

const storageKey = 'expenseTrackerEntries';
const entries = [];
let currentRate = 1;
let categoryChart;
let selectedFilterDate = null;

const dateInput = document.getElementById('expense-date');
const amountInput = document.getElementById('foreign-amount');
const currencySelect = document.getElementById('currency-select');
const convertedText = document.getElementById('converted-nt');
const rateText = document.getElementById('rate-text');
const statusText = document.getElementById('status-text');
const totalNTText = document.getElementById('total-nt');
const tableBody = document.getElementById('entry-table-body');
const form = document.getElementById('expense-form');
const filterDateInput = document.getElementById('filter-date');
const clearFilterBtn = document.getElementById('clear-filter-btn');
const dailySummaryDiv = document.getElementById('daily-summary');
const filteredTotalText = document.getElementById('filtered-total');
const filteredCountText = document.getElementById('filtered-count');

async function fetchRate(currency) {
  try {
    if (apiKey && apiKey !== 'YOUR_EXCHANGERATE_API_KEY') {
      const response = await fetch(`${exchangeApiBase}/${apiKey}/latest/${currency}`);
      const data = await response.json();
      if (data.result !== 'success') {
        throw new Error(data['error-type'] || '匯率讀取失敗');
      }
      if (typeof data.conversion_rates?.TWD !== 'number') {
        throw new Error('無法取得 TWD 匯率');
      }
      return data.conversion_rates.TWD;
    }

    // 備用 API 邏輯修正：改由台幣基準反推，避免免費版不支援修改 base 的限制
    const response = await fetch(`${fallbackApiBase}/${currency}`);
    const data = await response.json();
    if (!data || data.result !== 'success' || typeof data.rates?.TWD !== 'number') {
      throw new Error('無法從 API 取得 TWD 匯率');
    }
    return data.rates.TWD;
  } catch (error) {
    console.error('匯率 API 錯誤：', error);
    return null;
  }
}

function formatCurrency(value) {
  return Number(value).toLocaleString('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0
  });
}

function updateConversion() {
  const amount = Number(amountInput.value) || 0;
  const currency = currencySelect.value;

  if (!amount) {
    convertedText.textContent = '0';
    rateText.textContent = '匯率：-';
    return;
  }

  fetchRate(currency).then(rate => {
    if (!rate) {
      convertedText.textContent = '無法取得匯率';
      rateText.textContent = '匯率：錯誤';
      return;
    }
    currentRate = rate;
    const converted = amount * rate;
    convertedText.textContent = formatCurrency(converted);
    rateText.textContent = `匯率：1 ${currency} ≈ ${rate.toFixed(4)} TWD`;
  });
}

function computeTotals() {
  return entries.reduce((acc, entry) => {
    acc.total += entry.ntAmount;
    acc.categories[entry.category] = (acc.categories[entry.category] || 0) + entry.ntAmount;
    return acc;
  }, { total: 0, categories: {} });
}

function computeFilteredTotals(filterDate) {
  const filtered = entries.filter(entry => entry.date === filterDate);
  return {
    total: filtered.reduce((sum, entry) => sum + entry.ntAmount, 0),
    categories: filtered.reduce((acc, entry) => {
      acc[entry.category] = (acc[entry.category] || 0) + entry.ntAmount;
      return acc;
    }, {}),
    count: filtered.length
  };
}

function updateFilteredSummary() {
  if (!selectedFilterDate) {
    dailySummaryDiv.classList.remove('active');
    return;
  }

  dailySummaryDiv.classList.add('active');
  const filtered = computeFilteredTotals(selectedFilterDate);
  filteredTotalText.textContent = formatCurrency(filtered.total);
  filteredCountText.textContent = filtered.count;
}

function saveEntries() {
  localStorage.setItem(storageKey, JSON.stringify(entries));
}

function loadEntries() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) {
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      entries.push(...parsed);
    }
  } catch (error) {
    console.warn('載入本機儲存資料失敗：', error);
  }
}

function renderChart(categoryData) {
  const labels = Object.keys(categoryData);
  const values = Object.values(categoryData);
  const defaultLabels = ['美食', '交通', '住宿', '其他'];
  const chartLabels = labels.length ? labels : defaultLabels;
  const chartValues = values.length ? values : [0, 0, 0, 0];
  const chartColors = chartLabels.map(label => categoryColors[label] || '#64748b');
  const borderColors = chartColors.map(() => '#ffffff');

  if (categoryChart) {
    categoryChart.data.labels = chartLabels;
    categoryChart.data.datasets[0].data = chartValues;
    categoryChart.data.datasets[0].backgroundColor = chartColors;
    categoryChart.data.datasets[0].borderColor = borderColors;
    categoryChart.update();
    return;
  }

  const ctx = document.getElementById('category-chart').getContext('2d');
  categoryChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: chartLabels,
      datasets: [{
        data: chartValues,
        backgroundColor: chartColors,
        borderColor: borderColors,
        borderWidth: 2,
        hoverOffset: 12
      }]
    },
    options: {
      responsive: true,
      cutout: '35%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            usePointStyle: true,
            pointStyle: 'circle'
          }
        },
        tooltip: {
          callbacks: {
            label(context) {
              const value = Number(context.parsed).toLocaleString('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 });
              return `${context.label}: ${value}`;
            }
          }
        }
      }
    }
  });
}

function renderTable() {
  tableBody.innerHTML = '';

  let entriesToShow = entries.slice().reverse();
  
  // 如果有選中的日期，過濾記錄
  if (selectedFilterDate) {
    entriesToShow = entriesToShow.filter(entry => entry.date === selectedFilterDate);
  }

  if (entriesToShow.length === 0) {
    const message = selectedFilterDate 
      ? `尚無 ${selectedFilterDate} 的記錄`
      : '尚無記錄，請新增消費項目';
    tableBody.innerHTML = `<tr><td colspan="6" class="empty">${message}</td></tr>`;
    return;
  }

  entriesToShow.forEach(entry => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${entry.date}</td>
      <td>${entry.name}</td>
      <td>${entry.amount.toLocaleString()} ${entry.currency}</td>
      <td>${entry.currency}</td>
      <td>${entry.category}</td>
      <td>${formatCurrency(entry.ntAmount)}</td>
    `;
    tableBody.appendChild(row);
  });
}

function renderDashboard() {
  const totals = computeTotals();
  totalNTText.textContent = formatCurrency(totals.total);
  renderChart(totals.categories);
}

async function sendToGas(entry) {
  statusText.textContent = '正在將資料儲存到 Google 試算表...';
  try {
    const response = await fetch(gasEndpoint, {
      method: 'POST',
      body: JSON.stringify(entry)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorBody}`);
    }

    const result = await response.json();
    if (result.status === 'success' || result.success) {
      statusText.textContent = '已成功儲存至 Google 試算表。';
    } else {
      throw new Error(result.message || 'GAS 回傳錯誤');
    }
  } catch (error) {
    console.warn('無法送出 GAS，請確認 GAS Web App 已部署：', error);
    statusText.textContent = `GAS 儲存失敗：${error.message}`;
  }
}

function resetForm() {
  form.reset();
  convertedText.textContent = '0';
  rateText.textContent = '匯率：-';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const name = document.getElementById('item-name').value.trim();
  const amount = Number(amountInput.value);
  const currency = currencySelect.value;
  const category = document.getElementById('category-select').value;
  const selectedDate = dateInput.value;

  if (!selectedDate || !name || !amount || !currency) {
    return;
  }

  const ntAmount = Number((amount * currentRate).toFixed(0));
  const entry = {
    date: new Date(selectedDate).toLocaleDateString('zh-TW'),
    name,
    amount,
    currency,
    category,
    ntAmount
  };

  entries.push(entry);
  saveEntries();
  renderTable();
  renderDashboard();
  resetForm();
  sendToGas(entry);
});

amountInput.addEventListener('input', updateConversion);
currencySelect.addEventListener('change', updateConversion);

filterDateInput.addEventListener('change', (event) => {
  const value = event.target.value;
  if (value) {
    selectedFilterDate = new Date(value).toLocaleDateString('zh-TW');
    filterDateInput.value = value;
  } else {
    selectedFilterDate = null;
  }
  updateFilteredSummary();
  renderTable();
});

clearFilterBtn.addEventListener('click', () => {
  selectedFilterDate = null;
  filterDateInput.value = '';
  dailySummaryDiv.classList.remove('active');
  renderTable();
});

window.addEventListener('load', () => {
  loadEntries();
  renderTable();
  renderDashboard();
  const today = new Date().toISOString().slice(0, 10);
  if (dateInput && !dateInput.value) {
    dateInput.value = today;
  }
}); // 已修正全形括號錯誤
